import type * as vscode from 'vscode'

import {
    ChatClient,
    type CodeCompletionsClient,
    type Guardrails,
    type ResolvedConfiguration,
    type SourcegraphCompletionsClient,
    SourcegraphGuardrailsClient,
    type SyncObservable,
    featureFlagProvider,
    graphqlClient,
    isError,
} from '@sourcegraph/cody-shared'

import { ContextAPIClient } from './chat/context/contextAPIClient'
import { createClient as createCodeCompletionsClient } from './completions/client'
import type { PlatformContext } from './extension.common'
import type { LocalEmbeddingsController } from './local-context/local-embeddings'
import type { SymfRunner } from './local-context/symf'
import { logDebug, logger } from './log'
import type { AuthProvider } from './services/AuthProvider'

interface ExternalServices {
    chatClient: ChatClient
    completionsClient: SourcegraphCompletionsClient
    codeCompletionsClient: CodeCompletionsClient
    guardrails: Guardrails
    localEmbeddings: LocalEmbeddingsController | undefined
    symfRunner: SymfRunner | undefined
    contextAPIClient: ContextAPIClient | undefined
    dispose(): void
}

export async function configureExternalServices(
    context: vscode.ExtensionContext,
    config: SyncObservable<ResolvedConfiguration>,
    platform: Pick<
        PlatformContext,
        | 'createLocalEmbeddingsController'
        | 'createCompletionsClient'
        | 'createSentryService'
        | 'createOpenTelemetryService'
        | 'createSymfRunner'
    >,
    authProvider: AuthProvider
): Promise<ExternalServices> {
    const disposables: vscode.Disposable[] = []

    const sentryService = platform.createSentryService?.(config)
    if (sentryService) disposables.push(sentryService)

    const openTelemetryService = platform.createOpenTelemetryService?.(config)
    if (openTelemetryService) disposables.push(openTelemetryService)

    const completionsClient = platform.createCompletionsClient(config, logger)
    const codeCompletionsClient = createCodeCompletionsClient(config, logger)

    const symfRunner = platform.createSymfRunner?.(context, completionsClient, authProvider)
    if (symfRunner) disposables.push(symfRunner)

    const initialConfig = config.value.configuration
    if (initialConfig.codebase && isError(await graphqlClient.getRepoId(initialConfig.codebase))) {
        logDebug(
            'external-services:configureExternalServices',
            `Cody could not find the '${initialConfig.codebase}' repository on your Sourcegraph instance.\nPlease check that the repository exists. You can override the repository with the "cody.codebase" setting.`
        )
    }

    const localEmbeddings = await platform.createLocalEmbeddingsController?.(config)
    if (localEmbeddings) disposables.push(localEmbeddings)

    const chatClient = new ChatClient(completionsClient, () => authProvider.getAuthStatus())
    const guardrails = new SourcegraphGuardrailsClient(graphqlClient, config)
    const contextAPIClient = new ContextAPIClient(graphqlClient, featureFlagProvider)

    return {
        chatClient,
        completionsClient,
        codeCompletionsClient,
        guardrails,
        localEmbeddings,
        symfRunner,
        contextAPIClient,
        dispose(): void {
            for (const d of disposables) {
                d.dispose()
            }
        },
    }
}
