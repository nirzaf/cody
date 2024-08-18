import { describe, expect, it } from 'vitest'

import { defaultAuthStatus, unauthenticatedStatus } from '@sourcegraph/cody-shared'
import { newAuthStatus } from './utils'

describe('validateAuthStatus', () => {
    const options = {
        ...defaultAuthStatus,
        siteVersion: '',
        isDotCom: true,
        siteHasCodyEnabled: true,
        authenticated: true,
        endpoint: '',
        userCanUpgrade: false,
        username: 'cody',
        primaryEmail: 'me@domain.test',
        displayName: 'Test Name',
        avatarURL: 'https://domain.test/avatar.png',
    }

    it('returns auth state for invalid user on dotcom instance', () => {
        const expected = { ...unauthenticatedStatus, endpoint: options.endpoint }
        expect(
            newAuthStatus({
                ...options,
                authenticated: false,
            })
        ).toEqual(expected)
    })

    it('returns auth status for valid user with verified email on dotcom instance', () => {
        const expected = {
            ...options,
            authenticated: true,
            showInvalidAccessTokenError: false,
            siteHasCodyEnabled: true,
            isLoggedIn: true,
            codyApiVersion: 1,
        }
        expect(newAuthStatus(options)).toEqual(expected)
    })

    it('returns auth status for valid user without verified email on dotcom instance', () => {
        const expected = {
            ...options,
            authenticated: true,
            siteHasCodyEnabled: true,
            codyApiVersion: 1,
        }
        expect(
            newAuthStatus({
                ...options,
            })
        ).toEqual(expected)
    })

    it('returns auth status for valid user on enterprise instance with Cody enabled', () => {
        const expected = {
            ...options,
            authenticated: true,
            siteHasCodyEnabled: true,
            isLoggedIn: true,
            isDotCom: false,
            codyApiVersion: 1,
        }
        expect(
            newAuthStatus({
                ...options,
                isDotCom: false,
            })
        ).toEqual(expected)
    })

    it('returns auth status for invalid user on enterprise instance with Cody enabled', () => {
        const expected = { ...unauthenticatedStatus, endpoint: options.endpoint }
        expect(
            newAuthStatus({
                ...options,
                isDotCom: false,
                authenticated: false,
                siteHasCodyEnabled: false,
            })
        ).toEqual(expected)
    })

    it('returns auth status for valid user on enterprise instance with Cody disabled', () => {
        const expected = {
            ...options,
            authenticated: true,
            siteHasCodyEnabled: false,
            isDotCom: false,
            codyApiVersion: 1,
        }
        expect(
            newAuthStatus({
                ...options,
                isDotCom: false,
                siteHasCodyEnabled: false,
            })
        ).toEqual(expected)
    })

    it('returns auth status for invalid user on enterprise instance with Cody disabled', () => {
        const expected = { ...unauthenticatedStatus, endpoint: options.endpoint }
        expect(
            newAuthStatus({
                ...options,
                isDotCom: false,
                authenticated: false,
                siteHasCodyEnabled: false,
            })
        ).toEqual(expected)
    })

    it('returns auth status for signed in user without email and displayName on enterprise instance', () => {
        const expected = {
            ...options,
            authenticated: true,
            siteHasCodyEnabled: true,
            isLoggedIn: true,
            isDotCom: false,
            displayName: '',
            primaryEmail: '',
            codyApiVersion: 1,
        }
        expect(
            newAuthStatus({
                ...options,
                displayName: '',
                primaryEmail: '',
                isDotCom: false,
            })
        ).toEqual(expected)
    })

    it('returns API version 0 for a legacy instance', () => {
        const expected = {
            ...options,
            authenticated: true,
            siteHasCodyEnabled: true,
            isLoggedIn: true,
            isDotCom: false,
            siteVersion: '5.2.0',
            codyApiVersion: 0,
        }
        expect(
            newAuthStatus({
                ...options,
                isDotCom: false,
                siteVersion: '5.2.0',
            })
        ).toEqual(expected)
    })
})
