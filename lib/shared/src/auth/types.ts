import type { CodyLLMSiteConfiguration } from '../sourcegraph-api/graphql/client'

/**
 * The status of a users authentication, whether they're authenticated and have
 * a verified email.
 */
export interface AuthStatus {
    username: string
    endpoint: string
    isDotCom: boolean
    isLoggedIn: boolean
    showInvalidAccessTokenError: boolean
    authenticated: boolean
    siteHasCodyEnabled: boolean
    siteVersion: string
    codyApiVersion: number
    configOverwrites?: CodyLLMSiteConfiguration
    showNetworkError?: boolean
    primaryEmail: string | null
    displayName?: string
    avatarURL: string

    isOfflineMode?: boolean
}

export interface AuthStatusProvider {
    getAuthStatus(): AuthStatus
}

export const defaultAuthStatus: AuthStatus = {
    endpoint: '',
    isDotCom: true,
    isLoggedIn: false,
    showInvalidAccessTokenError: false,
    authenticated: false,
    siteHasCodyEnabled: false,
    siteVersion: '',
    username: '',
    primaryEmail: null,
    displayName: '',
    avatarURL: '',
    codyApiVersion: 0,
}

export const unauthenticatedStatus: AuthStatus = {
    endpoint: '',
    isDotCom: true,
    isLoggedIn: false,
    showInvalidAccessTokenError: true,
    authenticated: false,
    siteHasCodyEnabled: false,
    siteVersion: '',
    username: '',
    primaryEmail: null,
    displayName: '',
    avatarURL: '',
    codyApiVersion: 0,
}

export const networkErrorAuthStatus: Omit<AuthStatus, 'endpoint'> = {
    isDotCom: false,
    showInvalidAccessTokenError: false,
    authenticated: false,
    isLoggedIn: false,
    showNetworkError: true,
    siteHasCodyEnabled: false,
    siteVersion: '',
    username: '',
    primaryEmail: null,
    displayName: '',
    avatarURL: '',
    codyApiVersion: 0,
}

export const offlineModeAuthStatus: AuthStatus = {
    endpoint: '',
    isDotCom: true,
    isLoggedIn: true,
    isOfflineMode: true,
    showInvalidAccessTokenError: false,
    authenticated: true,
    siteHasCodyEnabled: true,
    siteVersion: '',
    username: 'offline',
    primaryEmail: null,
    displayName: '',
    avatarURL: '',
    codyApiVersion: 0,
}

export function isCodyProUser(authStatus: AuthStatus): boolean {
    return authStatus.isDotCom // TODO!(sqs)
}

export function isFreeUser(authStatus: AuthStatus): boolean {
    return false // TODO!(sqs)
}

export function isEnterpriseUser(authStatus: AuthStatus): boolean {
    return !authStatus.isDotCom
}
