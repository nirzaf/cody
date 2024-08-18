import type { CodyLLMSiteConfiguration } from '../sourcegraph-api/graphql/client'

/**
 * The status of a users authentication, whether they're authenticated and have
 * a verified email.
 */
export interface AuthStatus {
    endpoint: string
    isDotCom: boolean

    /**
     * Whether the user has successfully signed into the endpoint in this session (since starting
     * Cody or switching endpoints).
     */
    isLoggedIn: boolean

    user: {
        username: string

        authenticated: boolean
        primaryEmail: string | null
        displayName?: string
        avatarURL: string
    } | null

    site: {
        siteHasCodyEnabled: boolean
        siteVersion: string
        codyApiVersion: number
        configOverwrites?: CodyLLMSiteConfiguration
    } | null

    showInvalidAccessTokenError: boolean

    /**
     * - `online` means the last request was successful.
     * - `offline` means that the endpoint is unreachable.
     * - `error` means it's reachable but is returning an error.
     * - `unknown` is the initial state before it knows anything.
     */
    ephemeralConnectivityStatus: 'online' | 'offline' | 'error' | 'unknown'
}

export interface AuthStatusProvider {
    getAuthStatus(): AuthStatus
}

export const AUTH_STATUS_FIXTURE: AuthStatus = {
    endpoint: 'https://example.com',
    isDotCom: true,
    isLoggedIn: false,
    user: {
        username: 'alice',
        authenticated: false,
        primaryEmail: null,
        displayName: '',
        avatarURL: '',
    },
    site: {
        siteHasCodyEnabled: false,
        siteVersion: '',
        codyApiVersion: 0,
    },
    showInvalidAccessTokenError: false,
    ephemeralConnectivityStatus: 'online',
}

export function isCodyProUser(authStatus: AuthStatus): boolean {
    return authStatus.isDotCom
}

export function isFreeUser(authStatus: AuthStatus): boolean {
    return false // TODO!(sqs)
}

export function isEnterpriseUser(authStatus: AuthStatus): boolean {
    return !authStatus.isDotCom
}
