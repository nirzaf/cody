import type * as vscode from 'vscode'

import {
    ChatClient,
    type ClientConfiguration,
    type CodeCompletionsClient,
    type ConfigWatcher,
    type Guardrails,
    type GuardrailsClientConfig,
    type SourcegraphCompletionsClient,
    SourcegraphGuardrailsClient,
    featureFlagProvider,
    graphqlClient,
    isError,
} from '@sourcegraph/cody-shared'

import { ContextAPIClient } from './chat/context/contextAPIClient'
import { createClient as createCodeCompletionsClient } from './completions/client'
import { getAuthCredentials } from './configuration'
import type { PlatformContext } from './extension.common'
import type { LocalEmbeddingsConfig, LocalEmbeddingsController } from './local-context/local-embeddings'
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

    /** Update configuration for all of the services in this interface. */
    onConfigurationChange: (newConfig: ExternalServicesConfiguration) => void
}

type ExternalServicesConfiguration = Pick<
    ClientConfiguration,
    | 'codebase'
    | 'useContext'
    | 'customHeaders'
    | 'debugVerbose'
    | 'experimentalTracing'
    | 'isRunningInsideAgent'
    | 'agentIDE'
> &
    Pick<LocalEmbeddingsConfig, 'testingModelConfig'> &
    GuardrailsClientConfig

export async function configureExternalServices(
    context: vscode.ExtensionContext,
    config: ConfigWatcher<ExternalServicesConfiguration>,
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
    const initialConfig = config.get()
    const initialAuth = await getAuthCredentials()
    const configAndAuth = {
        config: initialConfig,
        auth: initialAuth,
    }

    const sentryService = platform.createSentryService?.(initialConfig, initialAuth)
    const openTelemetryService = platform.createOpenTelemetryService?.(configAndAuth)
    const completionsClient = platform.createCompletionsClient(initialAuth, logger)
    const codeCompletionsClient = createCodeCompletionsClient(initialAuth, logger)

    const symfRunner = platform.createSymfRunner?.(context, completionsClient, authProvider)

    if (initialConfig.codebase && isError(await graphqlClient.getRepoId(initialConfig.codebase))) {
        logDebug(
            'external-services:configureExternalServices',
            `Cody could not find the '${initialConfig.codebase}' repository on your Sourcegraph instance.\nPlease check that the repository exists. You can override the repository with the "cody.codebase" setting.`
        )
    }

    const localEmbeddings = await platform.createLocalEmbeddingsController?.({
        testingModelConfig: initialConfig.testingModelConfig,
        auth: initialAuth,
    })

    const chatClient = new ChatClient(completionsClient, () => authProvider.getAuthStatus())

    const guardrails = new SourcegraphGuardrailsClient(graphqlClient, initialConfig)

    const contextAPIClient = new ContextAPIClient(graphqlClient, featureFlagProvider)

    return {
        chatClient,
        completionsClient,
        codeCompletionsClient,
        guardrails,
        localEmbeddings,
        symfRunner,
        contextAPIClient,
        onConfigurationChange: async newConfig => {
            // TODO!(sqs): invert flow
            const auth = await getAuthCredentials()
            sentryService?.onAuthChange(auth)
            openTelemetryService?.onConfigurationChange({ config: newConfig, auth })
            completionsClient.onConfigurationChange(auth)
            codeCompletionsClient.onConfigurationChange(auth)
            guardrails.onConfigurationChange(newConfig)
            void localEmbeddings?.setAuth(auth)
        },
    }
}
