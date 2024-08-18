import { type AuthStatus, isDotCom } from '@sourcegraph/cody-shared'
import * as vscode from 'vscode'

export enum AccountMenuOptions {
    SignOut = 'Sign Out',
    Manage = 'Manage Account',
    Switch = 'Switch Account...',
}

export async function openAccountMenu(
    authStatus: AuthStatus | null
): Promise<AccountMenuOptions | undefined> {
    if (!authStatus?.user) {
        // TODO!(sqs): what to show here?
        return
    }

    const isDotComInstance = isDotCom(authStatus.endpoint)

    const user = authStatus.user
    const displayName = user.displayName || user.username
    const email = user.primaryEmail || 'No Email'
    const username = user.username || user.displayName
    const enterpriseDetail = `Enterprise Instance:\n${authStatus.endpoint}`

    const options = isDotComInstance ? [AccountMenuOptions.Manage] : []
    options.push(AccountMenuOptions.Switch, AccountMenuOptions.SignOut)

    const messageOptions = {
        modal: true,
        detail: isDotComInstance ? 'Using Cody on Sourcegraph.com' : enterpriseDetail,
    }

    const message = isDotComInstance
        ? `Signed in as ${displayName} (${email})`
        : `Signed in as @${username}`

    const option = await vscode.window.showInformationMessage(message, messageOptions, ...options)

    switch (option !== undefined) {
        case option?.startsWith('Sign Out'):
            return AccountMenuOptions.SignOut
        case option?.startsWith('Manage'):
            return AccountMenuOptions.Manage
        case option?.startsWith('Switch'):
            return AccountMenuOptions.Switch
        default:
            return undefined
    }
}
