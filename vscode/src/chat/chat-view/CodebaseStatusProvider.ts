import { isEqual } from 'lodash'
import * as vscode from 'vscode'

import {
    type ContextGroup,
    type ContextProvider,
    type ContextStatusProvider,
    type Disposable,
} from '@sourcegraph/cody-shared/src/codebase-context/context-status'
import { type Editor } from '@sourcegraph/cody-shared/src/editor'

import { getConfiguration } from '../../configuration'
import { getEditor } from '../../editor/active-editor'
import { type SymfRunner } from '../../local-context/symf'
import { getCodebaseFromWorkspaceUri } from '../../repository/repositoryHelpers'

interface CodebaseIdentifiers {
    local: string
    remote?: string
    remoteRepoId?: string
    setting?: string
}

/**
 * Provides and signals updates to the current codebase identifiers to use in the chat panel.
 */

export class CodebaseStatusProvider implements vscode.Disposable, ContextStatusProvider {
    private disposables: vscode.Disposable[] = []
    private eventEmitter: vscode.EventEmitter<ContextStatusProvider> = new vscode.EventEmitter<ContextStatusProvider>()

    // undefined means uninitialized, null means there is no current codebase
    private _currentCodebase: CodebaseIdentifiers | null | undefined = undefined

    // undefined means symf is not active or there is no current codebase
    private symfIndexStatus?: 'unindexed' | 'indexing' | 'ready' | 'failed'

    constructor(
        private readonly editor: Editor,
        private readonly symf: SymfRunner | null
    ) {
        this.disposables.push(
            vscode.window.onDidChangeActiveTextEditor(() => this.updateStatus()),
            vscode.workspace.onDidChangeWorkspaceFolders(() => this.updateStatus()),
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('cody.codebase')) {
                    return this.updateStatus()
                }
                return Promise.resolve()
            }),
            this.eventEmitter
        )

        if (this.symf) {
            this.disposables.push(
                this.symf.onIndexStart(() => {
                    void this.updateStatus()
                }),
                this.symf.onIndexEnd(() => {
                    void this.updateStatus()
                })
            )
        }
    }

    public dispose(): void {
        for (const d of this.disposables) {
            d.dispose()
        }
        this.disposables = []
    }

    public onDidChangeStatus(callback: (provider: ContextStatusProvider) => void): Disposable {
        return this.eventEmitter.event(callback)
    }

    public get status(): ContextGroup[] {
        if (this._currentCodebase === undefined) {
            void this.updateStatus()
            return []
        }
        const codebase = this._currentCodebase
        if (!codebase) {
            return []
        }

        const providers: ContextProvider[] = []
        providers.push(...this.getSymfIndexStatus())

        if (providers.length === 0) {
            return []
        }

        return [
            {
                name: codebase.local,
                providers,
            },
        ]
    }

    private getSymfIndexStatus(): ContextProvider[] {
        if (!this.symf || !this._currentCodebase || !this.symfIndexStatus) {
            return []
        }
        return [
            {
                kind: 'search',
                type: 'local',
                state: this.symfIndexStatus || 'unindexed',
            },
        ]
    }

    public async currentCodebase(): Promise<CodebaseIdentifiers | null> {
        if (this._currentCodebase === undefined) {
            // lazy initialization
            await this.updateStatus()
        }
        return this._currentCodebase || null
    }

    private async updateStatus(): Promise<void> {
        const didCodebaseChange = await this._updateCodebase_NoFire()
        const didSymfStatusChange = await this._updateSymfStatus_NoFire()
        if (didCodebaseChange || didSymfStatusChange) {
            this.eventEmitter.fire(this)
        }
    }

    private async _updateCodebase_NoFire(): Promise<boolean> {
        const workspaceRoot = this.editor.getWorkspaceRootUri()
        const config = getConfiguration()
        if (
            this._currentCodebase !== undefined &&
            workspaceRoot?.fsPath === this._currentCodebase?.local &&
            config.codebase === this._currentCodebase?.setting &&
            this._currentCodebase?.remoteRepoId
        ) {
            // do nothing if local codebase identifier is unchanged and we have a remote repo ID
            return false
        }

        let newCodebase: CodebaseIdentifiers | null = null
        if (workspaceRoot) {
            newCodebase = { local: workspaceRoot.fsPath, setting: config.codebase }
            const currentFile = getEditor()?.active?.document?.uri
            // Get codebase from config or fallback to getting codebase name from current file URL
            // Always use the codebase from config as this is manually set by the user
            newCodebase.remote =
                config.codebase || (currentFile ? getCodebaseFromWorkspaceUri(currentFile) : config.codebase)
            if (newCodebase.remote) {
                // await this.embeddingsClient.getRepoIdIfEmbeddingExists(newCodebase.remote)
                // TODO(dpc): Wire in use of repoId here and automatically included remotes search here.
            }
        }

        const didCodebaseChange = !isEqual(this._currentCodebase, newCodebase)
        this._currentCodebase = newCodebase
        return didCodebaseChange
    }

    private async _updateSymfStatus_NoFire(): Promise<boolean> {
        if (!this.symf) {
            return false
        }
        const newSymfStatus = this._currentCodebase?.local
            ? await this.symf.getIndexStatus(this._currentCodebase.local)
            : undefined
        const didSymfStatusChange = this.symfIndexStatus !== newSymfStatus
        this.symfIndexStatus = newSymfStatus
        return didSymfStatusChange
    }
}
