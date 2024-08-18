import * as vscode from 'vscode'

/**
 * Returns a known referral code to use based on the current VS Code environment.
 */
export function getAuthReferralCode(): string {
    return (
        {
            'vscode-insiders': 'CODY_INSIDERS',
            vscodium: 'CODY_VSCODIUM',
            cursor: 'CODY_CURSOR',
        }[vscode.env.uriScheme] || 'CODY'
    )
}
