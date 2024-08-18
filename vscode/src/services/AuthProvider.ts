import * as vscode from 'vscode'

import {
    type AuthCredentials,
    type AuthStatus,
    type AuthStatusProvider,
    ClientConfigSingleton,
    DOTCOM_URL,
    type ResolvedConfiguration,
    SourcegraphGraphQLAPIClient,
    type SyncObservable,
    type Unsubscribable,
    dependentAbortController,
    distinctUntilChanged,
    fromVSCodeEvent,
    isAbortError,
    isDotCom,
    isError,
    logError,
    singletonNotYetSet,
    syncObservableOf,
    telemetryRecorder,
} from '@sourcegraph/cody-shared'

import type { Observable } from 'observable-fns'
import { AccountMenuOptions, openAccountMenu } from '../auth/account-menu'
import { closeAuthProgressIndicator } from '../auth/auth-progress-indicator'
import { ACCOUNT_USAGE_URL, isSourcegraphToken } from '../chat/protocol'
import { inferCodyApiVersion } from '../chat/utils'
import { logDebug } from '../log'
import { syncModels } from '../models/sync'
import { maybeStartInteractiveTutorial } from '../tutorial/helpers'
import { AuthMenu, showAccessTokenInputBox, showInstanceURLInputBox } from './AuthMenus'
import { getAuthReferralCode } from './AuthProviderSimplified'
import { localStorage } from './LocalStorageProvider'
import { secretStorage } from './SecretStorageProvider'

const HAS_AUTHENTICATED_BEFORE_KEY = 'has-authenticated-before'

export const authProvider = singletonNotYetSet<AuthProvider>()

export class AuthProvider implements AuthStatusProvider, vscode.Disposable {
    private endpointHistory: string[] = []
    private status: AuthStatus | null = null
    private readonly didChangeEvent: vscode.EventEmitter<AuthStatus> =
        new vscode.EventEmitter<AuthStatus>()
    private disposables: vscode.Disposable[] = [this.didChangeEvent]

    private configSubscription: Unsubscribable

    public constructor(private config: SyncObservable<ResolvedConfiguration>) {
        this.loadEndpointHistory()

        const lastEndpoint = config.value.clientState.lastUsedEndpoint ?? DOTCOM_URL.toString()

        this.status = {
            endpoint: lastEndpoint,
            isLoggedIn: false,
            isDotCom: isDotCom(lastEndpoint),
            showInvalidAccessTokenError: false,
            ephemeralConnectivityStatus: 'unknown',
            user: null,
            site: null,
        }

        // TODO!(sqs)
        let firstAuth = true
        this.configSubscription = config.subscribe(async ({ clientState }) => {
            if (!firstAuth) {
                return
            }
            firstAuth = false

            // Attempt to auth with the last-used credentials.
            const token = await secretStorage.get(lastEndpoint || '')
            logDebug(
                'AuthProvider:init:lastEndpoint',
                token?.trim() ? 'Token recovered from secretStorage' : 'No token found in secretStorage',
                lastEndpoint
            )

            if (this.status?.isLoggedIn) {
                return // TODO!(sqs): how does it get here
            }
            await this.auth({
                endpoint: lastEndpoint,
                token: token || null,
                isExtensionStartup: true,
            }).catch(error => logError('AuthProvider:init:failed', lastEndpoint, { verbose: error }))
        })

        // TODO!(sqs)
        // interval(4000).subscribe(async () => {
        //     console.log('RELOAD')
        //     this.reloadAuthStatus()
        // })
    }

    public dispose(): void {
        this.configSubscription.unsubscribe()
        for (const d of this.disposables) {
            d.dispose()
        }
        this.disposables = []
    }

    public changes: Observable<AuthStatus> = fromVSCodeEvent(
        this.didChangeEvent.event,
        this.getAuthStatus.bind(this)
    ).pipe(distinctUntilChanged())

    // Display quickpick to select endpoint to sign in to
    public async signinMenu(type?: 'enterprise' | 'dotcom' | 'token', uri?: string): Promise<void> {
        const mode = this.status?.isLoggedIn ? 'switch' : 'signin'
        logDebug('AuthProvider:signinMenu', mode)
        telemetryRecorder.recordEvent('cody.auth.login', 'clicked')
        const item = await AuthMenu(mode, this.endpointHistory)
        if (!item) {
            return
        }
        const menuID = type || item?.id
        telemetryRecorder.recordEvent('cody.auth.signin.menu', 'clicked', {
            privateMetadata: { menuID },
        })
        switch (menuID) {
            case 'enterprise': {
                const instanceUrl = await showInstanceURLInputBox(item.uri)
                if (!instanceUrl) {
                    return
                }
                localStorage.saveEndpoint(instanceUrl)
                await this.redirectToEndpointLogin(instanceUrl)
                break
            }
            case 'dotcom':
                localStorage.saveEndpoint(DOTCOM_URL.href)
                await this.redirectToEndpointLogin(DOTCOM_URL.href)
                break
            case 'token': {
                const instanceUrl = await showInstanceURLInputBox(uri || item.uri)
                if (!instanceUrl) {
                    return
                }
                await this.signinMenuForInstanceUrl(instanceUrl)
                localStorage.saveEndpoint(instanceUrl)
                break
            }
            default: {
                // Auto log user if token for the selected instance was found in secret
                const selectedEndpoint = item.uri
                const token = await secretStorage.get(selectedEndpoint)
                let authStatus = await this.auth({
                    endpoint: selectedEndpoint,
                    token: token || null,
                })
                if (!authStatus?.isLoggedIn) {
                    const newToken = await showAccessTokenInputBox(item.uri)
                    if (!newToken) {
                        return
                    }
                    authStatus = await this.auth({
                        endpoint: selectedEndpoint,
                        token: newToken || null,
                    })
                }
                await showAuthResultMessage(selectedEndpoint, authStatus)
                logDebug('AuthProvider:signinMenu', mode, selectedEndpoint)
            }
        }
    }

    private async signinMenuForInstanceUrl(instanceUrl: string): Promise<void> {
        const accessToken = await showAccessTokenInputBox(instanceUrl)
        if (!accessToken) {
            return
        }
        const authState = await this.auth({
            endpoint: instanceUrl,
            token: accessToken,
        })
        telemetryRecorder.recordEvent('cody.auth.signin.token', 'clicked', {
            metadata: {
                success: authState.isLoggedIn ? 1 : 0,
            },
        })
        await showAuthResultMessage(instanceUrl, authState)
    }

    public async signoutMenu(): Promise<void> {
        telemetryRecorder.recordEvent('cody.auth.logout', 'clicked')
        const { endpoint } = this.getAuthStatus()

        if (endpoint) {
            await this.signout(endpoint)
            logDebug('AuthProvider:signoutMenu', endpoint)
        }
    }

    public async accountMenu(): Promise<void> {
        const selected = await openAccountMenu(this.status)
        if (selected === undefined) {
            return
        }

        switch (selected) {
            case AccountMenuOptions.Manage: {
                // Add the username to the web can warn if the logged in session on web is different from VS Code
                const uri = vscode.Uri.parse(ACCOUNT_USAGE_URL.toString()).with({
                    query: this.status?.user?.username
                        ? `cody_client_user=${encodeURIComponent(this.status?.user?.username)}`
                        : undefined,
                })
                void vscode.env.openExternal(uri)
                break
            }
            case AccountMenuOptions.Switch:
                await this.signinMenu()
                break
            case AccountMenuOptions.SignOut:
                await this.signoutMenu()
                break
        }
    }

    // Log user out of the selected endpoint (remove token from secret)
    private async signout(endpoint: string): Promise<void> {
        await secretStorage.deleteToken(endpoint)
        await localStorage.deleteEndpoint()
        await this.auth({ endpoint: '', token: null })
        await vscode.commands.executeCommand('setContext', 'cody.activated', false)
    }

    private async makeAuthStatus(
        credentials: AuthCredentials,
        signal: AbortSignal
    ): Promise<AuthStatus> {
        const endpoint = credentials.serverEndpoint
        const token = credentials.accessToken

        const endpointIsDotCom = isDotCom(endpoint)

        if (!token) {
            // TODO!(sqs): allow no token in Cody Web
            return {
                endpoint,
                isDotCom: endpointIsDotCom,
                isLoggedIn: false,
                showInvalidAccessTokenError: false,
                ephemeralConnectivityStatus: 'unknown',
                user: null,
                site: null,
            }
        }

        // Check if credentials are valid and if Cody is enabled for the credentials and endpoint.
        const client = new SourcegraphGraphQLAPIClient()
        client.setResolvedConfigurationObservable(
            syncObservableOf({
                configuration: this.config.value.configuration,
                auth: {
                    serverEndpoint: endpoint,
                    accessToken: token,
                    customHeaders: this.config.value.configuration.customHeaders, // TODO!(sqs): where to get these from?
                },
            })
        )

        const [{ enabled: siteHasCodyEnabled, version: siteVersion }, codyLLMConfiguration, userInfo] =
            await Promise.all([
                client.isCodyEnabled(signal),
                client.getCodyLLMConfiguration(signal),
                client.getCurrentUserInfo(signal),
            ])
        signal.throwIfAborted()

        if (isError(userInfo)) {
            return {
                endpoint,
                isDotCom: endpointIsDotCom,
                isLoggedIn: false,
                showInvalidAccessTokenError: isLikelyAccessTokenInvalidError(userInfo),
                ephemeralConnectivityStatus: isLikelyOfflineError(userInfo) ? 'offline' : 'error',
                user: null,
                site: null,
            }
        }

        const configOverwrites = isError(codyLLMConfiguration) ? undefined : codyLLMConfiguration

        return {
            endpoint,
            isDotCom: endpointIsDotCom,
            isLoggedIn: siteHasCodyEnabled && userInfo !== null,
            user: userInfo
                ? {
                      ...userInfo,
                      authenticated: true,
                      primaryEmail: userInfo.primaryEmail?.email ?? '',
                  }
                : null,
            site: {
                siteVersion,
                configOverwrites,
                siteHasCodyEnabled,
                codyApiVersion: inferCodyApiVersion(siteVersion, endpointIsDotCom),
            },
            showInvalidAccessTokenError: false,
            ephemeralConnectivityStatus: 'online',
        }
    }

    public getAuthStatus(): AuthStatus {
        if (!this.status) {
            throw new Error('AuthStatus is not ready')
        }
        return this.status
    }

    private inflightAuth: AbortController | null = null

    // It processes the authentication steps and stores the login info before sharing the auth status with chatview
    public async auth({
        endpoint,
        token,
        customHeaders,
        isExtensionStartup = false,
        signal,
    }: {
        endpoint: string
        token: string | null
        customHeaders?: Record<string, string> | null
        isExtensionStartup?: boolean
        signal?: AbortSignal
    }): Promise<AuthStatus> {
        if (this.inflightAuth) {
            this.inflightAuth.abort()
        }
        const abortController = dependentAbortController(signal)
        this.inflightAuth = abortController

        const credentials: AuthCredentials = {
            serverEndpoint: formatURL(endpoint) ?? '',
            accessToken: token,
            customHeaders: customHeaders || this.config.value.auth.customHeaders,
        }

        try {
            const authStatus = await this.makeAuthStatus(credentials, abortController.signal)
            abortController.signal.throwIfAborted()

            await this.storeAuthInfo(credentials)
            abortController.signal.throwIfAborted()

            await vscode.commands.executeCommand('setContext', 'cody.activated', authStatus.isLoggedIn)
            abortController.signal.throwIfAborted()

            await this.setAuthStatus(authStatus, abortController.signal)
            abortController.signal.throwIfAborted()

            // If the extension is authenticated on startup, it can't be a user's first
            // ever authentication. We store this to prevent logging first-ever events
            // for already existing users.
            if (isExtensionStartup && authStatus.isLoggedIn) {
                await this.setHasAuthenticatedBefore()
                abortController.signal.throwIfAborted()
            } else if (authStatus.isLoggedIn) {
                this.handleFirstEverAuthentication()
            }

            return authStatus
        } catch (error) {
            if (isAbortError(error)) {
                throw error
            }

            logDebug('AuthProvider:auth', 'failed', error)
            // TODO!(sqs): handle the kind of error this is
            return {
                endpoint,
                isDotCom: isDotCom(endpoint),
                isLoggedIn: false,
                showInvalidAccessTokenError: true,
                ephemeralConnectivityStatus: 'online',
                user: null,
                site: null,
            }
        } finally {
            if (this.inflightAuth === abortController) {
                this.inflightAuth = null
            }
        }
    }

    // Set auth status in case of reload TODO!(sqs): is this still needed?
    public async reloadAuthStatus(): Promise<AuthStatus> {
        await vscode.commands.executeCommand('setContext', 'cody.activated', false)
        return await this.auth({
            endpoint: this.config.value.auth.serverEndpoint,
            token: this.config.value.auth.accessToken,
            customHeaders: this.config.value.auth.customHeaders,
        })
    }

    // Set auth status and share it with chatview
    private async setAuthStatus(authStatus: AuthStatus, signal: AbortSignal): Promise<void> {
        this.status = authStatus
        try {
            await ClientConfigSingleton.getInstance().setAuthStatus(authStatus, signal)
            await syncModels(authStatus)
        } catch (error) {
            if (!isAbortError(error)) {
                logDebug('AuthProvider', 'updateAuthStatus error', error)
            }
        } finally {
            if (!signal.aborted) {
                this.didChangeEvent.fire(this.getAuthStatus())
                let eventValue: 'disconnected' | 'connected' | 'failed'
                if (
                    authStatus.ephemeralConnectivityStatus === 'error' ||
                    authStatus.showInvalidAccessTokenError
                ) {
                    eventValue = 'failed'
                } else if (authStatus.isLoggedIn) {
                    eventValue = 'connected'
                } else {
                    eventValue = 'disconnected'
                }
                telemetryRecorder.recordEvent('cody.auth', eventValue)
            }
        }
    }

    // Register URI Handler (vscode://sourcegraph.cody-ai) for resolving token
    // sending back from sourcegraph.com
    public async tokenCallbackHandler(
        uri: vscode.Uri,
        customHeaders: Record<string, string> | undefined
    ): Promise<void> {
        closeAuthProgressIndicator()

        if (!this.status) {
            return
        }

        const params = new URLSearchParams(uri.query)
        const token = params.get('code')
        const endpoint = this.status.endpoint
        if (!token || !endpoint) {
            return
        }
        const authState = await this.auth({ endpoint, token, customHeaders })
        telemetryRecorder.recordEvent('cody.auth.fromCallback.web', 'succeeded', {
            metadata: {
                success: authState?.isLoggedIn ? 1 : 0,
            },
        })
        if (authState?.isLoggedIn) {
            await vscode.window.showInformationMessage(`Signed in to ${endpoint}`)
        } else {
            await showAuthFailureMessage(endpoint)
        }
    }

    /** Open callback URL in browser to get token from instance. */
    public async redirectToEndpointLogin(uri: string): Promise<void> {
        const endpoint = formatURL(uri)
        if (!endpoint) {
            return
        }

        if (vscode.env.uiKind === vscode.UIKind.Web) {
            // VS Code Web needs a different kind of callback using asExternalUri and changes to our
            // UserSettingsCreateAccessTokenCallbackPage.tsx page in the Sourcegraph web app. So,
            // just require manual token entry for now.
            const newTokenNoCallbackUrl = new URL('/user/settings/tokens/new', endpoint)
            void vscode.env.openExternal(vscode.Uri.parse(newTokenNoCallbackUrl.href))
            void this.signinMenuForInstanceUrl(endpoint)
            return
        }

        const newTokenCallbackUrl = new URL('/user/settings/tokens/new/callback', endpoint)
        newTokenCallbackUrl.searchParams.append('requestFrom', getAuthReferralCode())
        await localStorage.saveEndpoint(endpoint)
        void vscode.env.openExternal(vscode.Uri.parse(newTokenCallbackUrl.href))
    }

    // Refresh current endpoint history with the one from local storage
    private loadEndpointHistory(): void {
        this.endpointHistory = localStorage.getEndpointHistory() || []
    }

    // Store endpoint in local storage, token in secret storage, and update endpoint history.
    private async storeAuthInfo(
        credentials: Pick<AuthCredentials, 'serverEndpoint' | 'accessToken'>
    ): Promise<void> {
        if (!credentials.serverEndpoint) {
            return
        }
        await localStorage.saveEndpoint(credentials.serverEndpoint)
        if (credentials.accessToken) {
            await secretStorage.storeToken(credentials.serverEndpoint, credentials.accessToken)
        }
        this.loadEndpointHistory()
    }

    // Logs a telemetry event if the user has never authenticated to Sourcegraph.
    private handleFirstEverAuthentication(): void {
        if (localStorage.get(HAS_AUTHENTICATED_BEFORE_KEY)) {
            // User has authenticated before, noop
            return
        }
        telemetryRecorder.recordEvent('cody.auth.login', 'firstEver')
        this.setHasAuthenticatedBefore()
        void maybeStartInteractiveTutorial()
    }

    private setHasAuthenticatedBefore() {
        return localStorage.set(HAS_AUTHENTICATED_BEFORE_KEY, 'true')
    }
}

export function isNetworkError(error: Error): boolean {
    const message = error.message
    return (
        message.includes('ENOTFOUND') ||
        message.includes('ECONNREFUSED') ||
        message.includes('ECONNRESET') ||
        message.includes('EHOSTUNREACH') ||
        message.includes('ETIMEDOUT')
    )
}

export function formatURL(uri: string): string | null {
    try {
        if (!uri) {
            return null
        }

        // Check if the URI is a sourcegraph token
        if (isSourcegraphToken(uri)) {
            throw new Error('Access Token is not a valid URL')
        }

        // Check if the URI is in the correct URL format
        // Add missing https:// if needed
        if (!uri.startsWith('http')) {
            uri = `https://${uri}`
        }

        const endpointUri = new URL(uri)
        return endpointUri.href
    } catch (error) {
        console.error('Invalid URL: ', error)
        return null
    }
}

async function showAuthResultMessage(
    endpoint: string,
    authStatus: AuthStatus | undefined
): Promise<void> {
    if (authStatus?.isLoggedIn) {
        const authority = vscode.Uri.parse(endpoint).authority
        await vscode.window.showInformationMessage(`Signed in to ${authority || endpoint}`)
    } else {
        await showAuthFailureMessage(endpoint)
    }
}

async function showAuthFailureMessage(endpoint: string): Promise<void> {
    const authority = vscode.Uri.parse(endpoint).authority
    await vscode.window.showErrorMessage(
        `Authentication failed. Please ensure Cody is enabled for ${authority} and verify your email address if required.`
    )
}

function isLikelyAccessTokenInvalidError(error: Error): boolean {
    const message = error.message.toLowerCase()
    return (
        message.includes('http status code 401') ||
        message.includes('http status code 403') ||
        message.includes('http status code 404')
    )
}

function isLikelyOfflineError(error: Error): boolean {
    const message = error.message.toLowerCase()
    return message.includes('failed to fetch')
}
