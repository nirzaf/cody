import type { GetFieldType } from 'lodash'
import * as vscode from 'vscode'
import { URI } from 'vscode-uri'

import {
    type ConfigurationWithAccessToken,
    type ContextGroup,
    type ContextStatusProvider,
    type EmbeddingsModelConfig,
    type EmbeddingsSearchResult,
    FeatureFlag,
    type FileURI,
    type LocalEmbeddingsFetcher,
    type LocalEmbeddingsProvider,
    type PromptString,
    featureFlagProvider,
    isDotCom,
    isFileURI,
    recordErrorToSpan,
    telemetryRecorder,
    uriBasename,
    wrapInActiveSpan,
} from '@sourcegraph/cody-shared'

import type { IndexHealthResultFound, IndexRequest } from '../jsonrpc/embeddings-protocol'
import type { MessageHandler } from '../jsonrpc/jsonrpc'
import { logDebug } from '../log'
import { captureException } from '../services/sentry/sentry'
import { CodyEngineService } from './cody-engine'

export async function createLocalEmbeddingsController(
    context: vscode.ExtensionContext,
    config: LocalEmbeddingsConfig
): Promise<LocalEmbeddingsController> {
    const modelConfig =
        config.testingModelConfig ||
        (await featureFlagProvider.evaluateFeatureFlag(FeatureFlag.CodyEmbeddingsGenerateMetadata))
            ? sourcegraphMetadataModelConfig
            : sourcegraphModelConfig

    return new LocalEmbeddingsController(context, config, modelConfig)
}

export type LocalEmbeddingsConfig = Pick<
    ConfigurationWithAccessToken,
    'serverEndpoint' | 'accessToken'
> & {
    testingModelConfig: EmbeddingsModelConfig | undefined
}

const CODY_GATEWAY_PROD_ENDPOINT = 'https://cody-gateway.sourcegraph.com/v1/embeddings'

function getIndexLibraryPath(modelSuffix: string): FileURI {
    switch (process.platform) {
        case 'darwin':
            return URI.file(
                `${process.env.HOME}/Library/Caches/com.sourcegraph.cody/embeddings` +
                    (modelSuffix === '' ? '' : '/' + modelSuffix)
            )
        case 'linux':
            return URI.file(
                `${process.env.HOME}/.cache/com.sourcegraph.cody/embeddings` +
                    (modelSuffix === '' ? '' : '/' + modelSuffix)
            )
        case 'win32':
            return URI.file(
                `${process.env.LOCALAPPDATA}\\com.sourcegraph.cody\\embeddings` +
                    (modelSuffix === '' ? '' : '\\' + modelSuffix)
            )
        default:
            throw new Error(`Unsupported platform: ${process.platform}`)
    }
}

interface RepoState {
    repoName: string | false
    indexable: boolean
    errorReason: GetFieldType<LocalEmbeddingsProvider, 'errorReason'>
}

const sourcegraphModelConfig: EmbeddingsModelConfig = {
    model: 'sourcegraph/st-multi-qa-mpnet-base-dot-v1',
    dimension: 768,
    provider: 'sourcegraph',
    endpoint: CODY_GATEWAY_PROD_ENDPOINT,
    indexPath: getIndexLibraryPath('st-v1'),
}

const sourcegraphMetadataModelConfig: EmbeddingsModelConfig = {
    model: 'sourcegraph/st-multi-qa-mpnet-metadata',
    dimension: 768,
    provider: 'sourcegraph',
    endpoint: CODY_GATEWAY_PROD_ENDPOINT,
    indexPath: getIndexLibraryPath('st-metadata'),
}

export class LocalEmbeddingsController
    implements LocalEmbeddingsFetcher, ContextStatusProvider, vscode.Disposable
{
    private disposables: vscode.Disposable[] = []

    // The cody-engine child process, if starting or started.
    private service: Promise<MessageHandler> | undefined
    // True if the service has finished starting and been initialized.
    private serviceStarted = false
    // The access token for Cody Gateway.
    private accessToken: string | undefined
    // Whether the account is a consumer account.
    private endpointIsDotcom = false
    // The last index we loaded, or attempted to load, if any.
    private lastRepo: { dir: FileURI; repoName: string | false } | undefined
    // The last health report, if any.
    private lastHealth: IndexHealthResultFound | undefined
    // The last error from indexing, if any.
    private lastError: string | undefined
    // Map of cached states for loaded indexes.
    private repoState: Map<string /* uri.toString() */, RepoState> = new Map()
    // If indexing is in progress, the path of the repo being indexed.
    private dirBeingIndexed: FileURI | undefined

    // The status bar item local embeddings is displaying, if any.
    private statusBar: vscode.StatusBarItem | undefined

    // Fires when available local embeddings (may) have changed. This updates
    // the codebase context, which touches the network and file system, so only
    // use it for major changes like local embeddings being available at all,
    // or the first index for a repository comes online.
    private readonly changeEmitter = new vscode.EventEmitter<LocalEmbeddingsController>()

    constructor(
        private readonly context: vscode.ExtensionContext,
        config: LocalEmbeddingsConfig,
        private readonly modelConfig: EmbeddingsModelConfig
    ) {
        logDebug('LocalEmbeddingsController', 'constructor')
        this.disposables.push(this.changeEmitter, this.statusEmitter)
        this.disposables.push(
            vscode.commands.registerCommand('cody.embeddings.resolveIssue', () =>
                this.resolveIssueCommand()
            )
        )

        // Pick up the initial access token, and whether the account is dotcom.
        this.accessToken = config.accessToken || undefined
        this.endpointIsDotcom = isDotCom(config.serverEndpoint)
    }

    public dispose(): void {
        for (const disposable of this.disposables) {
            disposable.dispose()
        }
        this.statusBar?.dispose()
    }

    public get onChange(): vscode.Event<LocalEmbeddingsController> {
        return this.changeEmitter.event
    }

    // Hint that local embeddings should start cody-engine, if necessary.
    public async start(): Promise<void> {
        logDebug('LocalEmbeddingsController', 'start')
        wrapInActiveSpan('embeddings.start', async span => {
            span.setAttribute('sampled', true)
            span.setAttribute('provider', this.modelConfig.provider)
            await this.getService()
            const repoUri = vscode.workspace.workspaceFolders?.[0]?.uri
            if (repoUri && isFileURI(repoUri)) {
                span.setAttribute('hasRepo', true)
                const loadedOk = await this.eagerlyLoad(repoUri)
                span.setAttribute('loadedOk', loadedOk)
                if (!loadedOk) {
                    // failed to load the index, let's see if we should start indexing
                    if (this.canAutoIndex()) {
                        span.setAttribute('autoIndex', true)
                        this.index()
                    }
                }
            }
        })
    }

    public async setAccessToken(serverEndpoint: string, token: string | null): Promise<void> {
        const endpointIsDotcom = isDotCom(serverEndpoint)
        logDebug(
            'LocalEmbeddingsController',
            'setAccessToken',
            endpointIsDotcom ? 'is dotcom' : 'not dotcom'
        )
        if (endpointIsDotcom !== this.endpointIsDotcom) {
            // We will show, or hide, status depending on whether we are using
            // dotcom. We do not offer local embeddings to Enterprise.
            this.statusEmitter.fire(this)
            if (this.serviceStarted) {
                this.changeEmitter.fire(this)
            }
        }
        this.endpointIsDotcom = endpointIsDotcom
        if (token === this.accessToken) {
            return Promise.resolve()
        }
        this.accessToken = token || undefined
        // TODO: Add a "drop token" for sign out
        if (token && this.serviceStarted) {
            await (await this.getService()).request('embeddings/set-token', token)
        }
    }

    private getService(): Promise<MessageHandler> {
        if (!this.service) {
            const instance = CodyEngineService.getInstance(this.context)
            this.service = instance.getService(this.setupLocalEmbeddingsService)
        }
        return this.service
    }

    private setupLocalEmbeddingsService = async (service: MessageHandler): Promise<void> => {
        // TODO: Add more states for cody-engine fetching and trigger status updates here
        service.registerNotification('embeddings/progress', obj => {
            if (typeof obj === 'object') {
                switch (obj.type) {
                    case 'progress': {
                        this.lastError = undefined
                        const percent = Math.floor((100 * obj.numItems) / obj.totalItems)
                        if (this.statusBar) {
                            this.statusBar.text = `Indexing Embeddings… (${percent.toFixed(0)}%)`
                            this.statusBar.backgroundColor = undefined
                            this.statusBar.tooltip = obj.currentPath
                            this.statusBar.show()
                        }
                        return
                    }
                    case 'error': {
                        this.lastError = obj.message
                        this.loadAfterIndexing()
                        return
                    }
                    case 'done': {
                        this.lastError = undefined
                        this.loadAfterIndexing()
                        return
                    }
                }
            }
            logDebug('LocalEmbeddingsController', 'unknown notification', JSON.stringify(obj))
        })

        logDebug('LocalEmbeddingsController', 'spawnAndBindService', 'service started, initializing')

        const initResult = await service.request('embeddings/initialize', {
            codyGatewayEndpoint: this.modelConfig.endpoint,
            indexPath: this.modelConfig.indexPath.fsPath,
        })
        logDebug('LocalEmbeddingsController', 'spawnAndBindService', 'initialized', {
            verbose: {
                initResult,
                tokenAvailable: !!this.accessToken,
            },
        })

        if (this.accessToken) {
            // Set the initial access token
            await service.request('embeddings/set-token', this.accessToken)
        }
        this.serviceStarted = true
        this.changeEmitter.fire(this)
    }

    // After indexing succeeds or fails, try to load the index. Update state
    // indicating we are no longer loading the index.
    private loadAfterIndexing(): void {
        if (
            this.dirBeingIndexed &&
            (!this.lastRepo || this.lastRepo.dir.toString() === this.dirBeingIndexed.toString())
        ) {
            const path = this.dirBeingIndexed
            void (async () => {
                const loadedOk = await this.eagerlyLoad(path)
                logDebug('LocalEmbeddingsController', 'load after indexing "done"', path, loadedOk)
                this.changeEmitter.fire(this)
                if (loadedOk && !this.lastError) {
                    await vscode.window.showInformationMessage('✨ Cody Embeddings Index Complete')
                }
            })()
        }

        if (this.statusBar) {
            this.statusBar.dispose()
            this.statusBar = undefined
        }

        this.dirBeingIndexed = undefined
        this.statusEmitter.fire(this)
    }

    // ContextStatusProvider implementation

    private statusEmitter: vscode.EventEmitter<ContextStatusProvider> = new vscode.EventEmitter()

    public onDidChangeStatus(callback: (provider: ContextStatusProvider) => void): vscode.Disposable {
        return this.statusEmitter.event(callback)
    }

    public get status(): ContextGroup[] {
        logDebug('LocalEmbeddingsController', 'get status')
        if (!this.endpointIsDotcom) {
            // There are no local embeddings for Enterprise.
            return []
        }
        // TODO: Summarize the path with ~, etc.
        const dir = this.lastRepo?.dir ?? vscode.workspace.workspaceFolders?.[0]?.uri
        if (!dir || !this.lastRepo) {
            return [
                {
                    dir,
                    displayName: dir ? uriBasename(dir) : '(No workspace loaded)',
                    providers: [
                        {
                            kind: 'embeddings',
                            state: 'indeterminate',
                            embeddingsAPIProvider: this.modelConfig.provider,
                        },
                    ],
                },
            ]
        }
        if (this.dirBeingIndexed?.toString() === dir.toString()) {
            return [
                {
                    dir,
                    displayName: uriBasename(dir),
                    providers: [
                        {
                            kind: 'embeddings',
                            state: 'indexing',
                            embeddingsAPIProvider: this.modelConfig.provider,
                        },
                    ],
                },
            ]
        }
        if (this.lastRepo.repoName) {
            return [
                {
                    dir,
                    displayName: uriBasename(dir),
                    providers: [
                        {
                            kind: 'embeddings',
                            state: 'ready',
                            embeddingsAPIProvider: this.modelConfig.provider,
                        },
                    ],
                },
            ]
        }
        const repoState = this.repoState.get(dir.toString())
        let stateAndErrors: {
            state: 'unconsented' | 'no-match'
            errorReason?: 'not-a-git-repo' | 'git-repo-has-no-remote'
        }
        if (repoState?.indexable) {
            stateAndErrors = { state: 'unconsented' }
        } else if (repoState?.errorReason) {
            stateAndErrors = { state: 'no-match', errorReason: repoState.errorReason }
        } else {
            logDebug('LocalEmbeddings', 'state', '"no-match" state should provide a reason')
            stateAndErrors = { state: 'no-match' }
        }

        return [
            {
                dir,
                displayName: uriBasename(dir),
                providers: [
                    {
                        kind: 'embeddings',
                        ...stateAndErrors,
                        embeddingsAPIProvider: this.modelConfig.provider,
                    },
                ],
            },
        ]
    }

    // Interactions with cody-engine

    public async index(): Promise<void> {
        if (!(this.endpointIsDotcom && this.lastRepo?.dir && !this.lastRepo?.repoName)) {
            // TODO: Support index updates.
            logDebug('LocalEmbeddingsController', 'index', 'no repository to index/already indexed')
            return
        }
        const repoPath = this.lastRepo.dir
        logDebug('LocalEmbeddingsController', 'index', 'starting repository', repoPath)
        await this.indexRequest({
            repoPath: repoPath.fsPath,
            mode: { type: 'new', model: this.modelConfig.model, dimension: this.modelConfig.dimension },
        })
    }

    public async indexRetry(): Promise<void> {
        if (!(this.endpointIsDotcom && this.lastRepo?.dir)) {
            logDebug('LocalEmbeddingsController', 'indexRetry', 'no repository to retry')
            return
        }
        const repoPath = this.lastRepo.dir
        logDebug('LocalEmbeddingsController', 'indexRetry', 'continuing to index repository', repoPath)
        await this.indexRequest({ repoPath: repoPath.fsPath, mode: { type: 'continue' } })
    }

    private async indexRequest(options: IndexRequest): Promise<void> {
        try {
            await (await this.getService()).request('embeddings/index', options)
            this.dirBeingIndexed = URI.file(options.repoPath)
            this.statusBar?.dispose()
            this.statusBar = vscode.window.createStatusBarItem(
                'cody-local-embeddings',
                vscode.StatusBarAlignment.Right,
                0
            )
            this.statusEmitter.fire(this)
        } catch (error: any) {
            logDebug('LocalEmbeddingsController', captureException(error), error)
        }
    }

    // Tries to load an index for the repo at the specified path, skipping any
    // cached results in `load`. This is used:
    // - When the service starts, to fulfill an earlier load request.
    // - When indexing finishes, to try to load the updated index.
    // - To implement the final step of `load`, if we did not hit any cached
    //   results.
    private async eagerlyLoad(repoDir: FileURI): Promise<boolean> {
        await wrapInActiveSpan('embeddings.load', async span => {
            try {
                const { repoName, indexSizeBytes } = await (await this.getService()).request(
                    'embeddings/load',
                    repoDir.fsPath
                )
                this.repoState.set(repoDir.toString(), {
                    repoName,
                    indexable: true,
                    errorReason: undefined,
                })
                this.lastRepo = {
                    dir: repoDir,
                    repoName,
                }
                span.setAttribute('repoLoaded', true)
                span.setAttribute('indexSize', indexSizeBytes)

                telemetryRecorder.recordEvent('cody.context.embeddings', 'loaded', {
                    metadata: {
                        indexSize: indexSizeBytes,
                    },
                })

                // Start a health check on the index.
                void (async () => {
                    wrapInActiveSpan('embeddings.index-health', async span => {
                        try {
                            const health = await (await this.getService()).request(
                                'embeddings/index-health',
                                {
                                    repoName,
                                }
                            )
                            logDebug('LocalEmbeddingsController', 'index-health', JSON.stringify(health))
                            span.setAttribute('repoHealthSucceeded', true)
                            span.setAttribute('repoFound', health.type === 'found')
                            if (health.type !== 'found') {
                                return
                            }
                            span.setAttribute('numItems', health.numItems)
                            span.setAttribute('numFiles', health.numFiles)
                            span.setAttribute('needsEmbedding', health.numItemsNeedEmbedding > 0)
                            await this.onHealthReport(repoDir, health)
                        } catch (error) {
                            logDebug(
                                'LocalEmbeddingsController',
                                'index-health',
                                captureException(error),
                                JSON.stringify(error)
                            )
                            span.setAttribute('repoHealthSucceeded', false)
                        }
                    })
                })()
            } catch (error: any) {
                logDebug(
                    'LocalEmbeddingsController',
                    'load',
                    captureException(error),
                    JSON.stringify(error)
                )

                const noRemoteErrorMessage =
                    "repository does not have a default fetch URL, so can't be named for an index"
                const noRemote = error.message === noRemoteErrorMessage

                const notAGitRepositoryErrorMessage = /does not appear to be a git repository/
                const notGit = notAGitRepositoryErrorMessage.test(error.message)

                let errorReason: GetFieldType<LocalEmbeddingsProvider, 'errorReason'>
                if (notGit) {
                    errorReason = 'not-a-git-repo'
                } else if (noRemote) {
                    errorReason = 'git-repo-has-no-remote'
                } else {
                    errorReason = undefined
                }
                if (errorReason) {
                    span.setAttribute('errorReason', errorReason)
                }
                this.repoState.set(repoDir.toString(), {
                    repoName: false,
                    indexable: !(notGit || noRemote),
                    errorReason,
                })

                // TODO: Log telemetry error messages to prioritize supporting
                // repos without remotes, other SCCS, etc.

                this.lastRepo = { dir: repoDir, repoName: false }
            }
        })
        this.statusEmitter.fire(this)
        return !!this.lastRepo?.repoName
    }

    // After loading a repo, we asynchronously check whether the repository
    // still needs embeddings.
    private async onHealthReport(repoDir: FileURI, health: IndexHealthResultFound): Promise<void> {
        if (repoDir.toString() !== this.lastRepo?.dir.toString()) {
            // We've loaded a different repo since this health report; ignore it.
            return
        }
        this.lastHealth = health
        const hasIssue = health.numItemsNeedEmbedding > 0
        if (hasIssue) {
            const canRetry = this.canAutoIndex() && !this.lastError
            let retrySucceeded = true
            if (canRetry) {
                try {
                    await this.indexRetry()
                } catch {
                    retrySucceeded = false
                }
            }
            if (!canRetry || !retrySucceeded) {
                await vscode.commands.executeCommand('setContext', 'cody.embeddings.hasIssue', hasIssue)
                this.updateIssueStatusBar()
            }
        }
    }

    private getNeedsEmbeddingText(options?: { prefix?: string; suffix?: string }): string {
        if (!this.lastHealth?.numItemsNeedEmbedding) {
            return ''
        }
        const percentDone = Math.floor(
            (100 * (this.lastHealth.numItems - this.lastHealth.numItemsNeedEmbedding)) /
                this.lastHealth.numItems
        )
        return `${options?.prefix || ''}Cody Embeddings index for ${
            this.lastRepo?.dir || 'this repository'
        } is only ${percentDone.toFixed(0)}% complete.${options?.suffix || ''}`
    }

    // Check if auto-indexing is enabled and if we're using the Sourcegraph provider.
    private canAutoIndex(): boolean {
        return this.modelConfig.provider === 'sourcegraph'
    }

    private updateIssueStatusBar(): void {
        this.statusBar?.dispose()
        this.statusBar = vscode.window.createStatusBarItem(
            'cody-local-embeddings',
            vscode.StatusBarAlignment.Right,
            0
        )
        this.statusBar.text = 'Embeddings Incomplete'
        const needsEmbeddingMessage = this.getNeedsEmbeddingText({
            prefix: '\n\n',
            suffix: ' Click to resolve.',
        })
        const errorMessage = this.lastError ? `\n\nError: ${this.lastError}` : ''
        this.statusBar.tooltip = new vscode.MarkdownString(
            `#### Cody Embeddings Incomplete\n\n${needsEmbeddingMessage}${errorMessage}`
        )
        this.statusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground')
        this.statusBar.command = 'cody.embeddings.resolveIssue'
        this.statusBar.show()
    }

    // The user has clicked on the status bar to resolve an issue with embeddings.
    private resolveIssueCommand(): void {
        if (!(this.lastHealth || this.lastError)) {
            // There's nothing to do.
            return
        }
        if (this.lastHealth?.numItemsNeedEmbedding) {
            void (async () => {
                try {
                    const errorMessage = this.lastError ? `\n\nError: ${this.lastError}` : ''
                    const choice = await vscode.window.showWarningMessage(
                        this.getNeedsEmbeddingText() + errorMessage,
                        'Continue Indexing',
                        'Cancel'
                    )
                    switch (choice) {
                        case 'Cancel':
                            return
                        case 'Continue Indexing':
                            await this.indexRetry()
                    }
                } catch (error: any) {
                    logDebug(
                        'LocalEmbeddingsController',
                        'resolveIssueCommand',
                        captureException(error),
                        JSON.stringify(error)
                    )
                    await vscode.window.showErrorMessage(
                        `Cody Embeddings — Error resolving embeddings issue: ${error?.message}`
                    )
                }
            })()
        }
    }

    /** {@link LocalEmbeddingsFetcher.getContext} */
    public async getContext(query: PromptString, numResults: number): Promise<EmbeddingsSearchResult[]> {
        if (!this.endpointIsDotcom) {
            return []
        }
        return wrapInActiveSpan('LocalEmbeddingsController.query', async span => {
            try {
                span.setAttribute('provider', this.modelConfig.provider)
                const lastRepo = this.lastRepo
                if (!lastRepo?.repoName) {
                    span.setAttribute('noResultReason', 'last-repo-not-set')
                    return []
                }
                const service = await this.getService()
                const resp = await service.request('embeddings/query', {
                    repoName: lastRepo.repoName,
                    query: query.toString(),
                    numResults,
                })
                logDebug(
                    'LocalEmbeddingsController',
                    'query',
                    `returning ${resp.results.length} results`
                )
                return resp.results.map(result => ({
                    ...result,
                    uri: vscode.Uri.joinPath(lastRepo.dir, result.fileName),
                }))
            } catch (error) {
                logDebug('LocalEmbeddingsController', 'query', captureException(error), error)
                recordErrorToSpan(span, error as Error)
                return []
            }
        })
    }
}
