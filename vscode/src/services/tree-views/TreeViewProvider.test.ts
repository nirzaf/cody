import { describe, expect, it, vi } from 'vitest'
import type * as vscode from 'vscode'

import { DOTCOM_URL, isDotCom } from '@sourcegraph/cody-shared'

import { newAuthStatus } from '../../chat/utils'
import { emptyMockFeatureFlagProvider, vsCodeMocks } from '../../testutils/mocks'

import { TreeViewProvider } from './TreeViewProvider'

vi.mock('vscode', () => ({
    ...vsCodeMocks,
    env: {},
}))

describe('TreeViewProvider', () => {
    let tree: TreeViewProvider

    /**
     * Waits for the tree to fire its onDidChangeTreeData
     */
    async function waitForTreeUpdate() {
        let sub: vscode.Disposable
        return new Promise<void>(resolve => {
            sub = tree.onDidChangeTreeData(() => {
                sub.dispose()
                resolve()
            })
        })
    }

    /**
     * Refreshes the tree with the new auth flags and waits for the update.
     */
    async function updateTree({
        endpoint,
    }: {
        endpoint: URL
    }): Promise<void> {
        const nextUpdate = waitForTreeUpdate()
        tree.setAuthStatus(
            newAuthStatus({
                endpoint: endpoint.toString(),
                isDotCom: isDotCom(endpoint.toString()),
                authenticated: true,
                siteHasCodyEnabled: true,
                siteVersion: '',
                username: 'someuser',
                primaryEmail: 'me@domain.test',
                displayName: 'Test Name',
                avatarURL: 'https://domain.test/avatar.png',
            })
        )
        return nextUpdate
    }

    async function findTreeItem(label: string) {
        const items = await tree.getChildren()
        return items.find(item => (item.resourceUri as any)?.label === label)
    }

    describe('Account link', () => {
        it('is shown when user is on dotcom', async () => {
            tree = new TreeViewProvider('support', emptyMockFeatureFlagProvider)
            await updateTree({ endpoint: DOTCOM_URL })
            const accountTreeItem = await findTreeItem('Account')
            expect(accountTreeItem).not.toBeUndefined()
        })
        it('is shown when user is Enterprise', async () => {
            tree = new TreeViewProvider('support', emptyMockFeatureFlagProvider)
            await updateTree({ endpoint: new URL('https://example.org') })
            expect(await findTreeItem('Account')).not.toBeUndefined()
        })
    })
})
