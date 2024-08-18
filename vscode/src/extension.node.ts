// Sentry should be imported first
import { NodeSentryService } from './services/sentry/sentry.node'

import {
    type ResolvedConfiguration,
    type SyncObservable,
    subscriptionDisposable,
} from '@sourcegraph/cody-shared'
import * as vscode from 'vscode'
import { startTokenReceiver } from './auth/token-receiver'
import { CommandsProvider } from './commands/services/provider'
import { BfgRetriever } from './completions/context/retrievers/bfg/bfg-retriever'
import { SourcegraphNodeCompletionsClient } from './completions/nodeClient'
import type { ExtensionApi } from './extension-api'
import { type ExtensionClient, defaultVSCodeExtensionClient } from './extension-client'
import { activate as activateCommon } from './extension.common'
import { initializeNetworkAgent, setCustomAgent } from './fetch.node'
import {
    type LocalEmbeddingsController,
    createLocalEmbeddingsController,
} from './local-context/local-embeddings'
import { SymfRunner } from './local-context/symf'
import { OpenTelemetryService } from './services/open-telemetry/OpenTelemetryService.node'

/**
 * Activation entrypoint for the VS Code extension when running VS Code as a desktop app
 * (Node.js/Electron).
 */
export function activate(
    context: vscode.ExtensionContext,
    extensionClient?: ExtensionClient
): Promise<ExtensionApi> {
    initializeNetworkAgent(context)

    // When activated by VSCode, we are only passed the extension context.
    // Create the default client for VSCode.
    extensionClient ||= defaultVSCodeExtensionClient()

    // Local embeddings are disabled by default since we are now moving towards
    // server-side embeddings. One important side-effect of disabling local
    // embeddings is that we no longer download the cody-engine binary from
    // github.com, which has been problematic for some enterprise customers.
    // We still keep the functionality in the codebase for now in case
    // we want to revert the decision (for example, only do local embeddings
    // for Cody Pro users until we have Multitenancy).
    const isLocalEmbeddingsEnabled = vscode.workspace
        .getConfiguration()
        .get<boolean>('cody.experimental.localEmbeddings.enabled', false)

    const isSymfEnabled = vscode.workspace
        .getConfiguration()
        .get<boolean>('cody.experimental.symf.enabled', true)

    const isTelemetryEnabled = vscode.workspace
        .getConfiguration()
        .get<boolean>('cody.experimental.telemetry.enabled', true)

    return activateCommon(context, {
        createLocalEmbeddingsController: isLocalEmbeddingsEnabled
            ? (config: SyncObservable<ResolvedConfiguration>): Promise<LocalEmbeddingsController> =>
                  createLocalEmbeddingsController(context, config)
            : undefined,
        createCompletionsClient: (...args) => new SourcegraphNodeCompletionsClient(...args),
        createCommandsProvider: () => new CommandsProvider(),
        createSymfRunner: isSymfEnabled ? (...args) => new SymfRunner(...args) : undefined,
        createBfgRetriever: () => new BfgRetriever(context),
        createSentryService: (...args) => new NodeSentryService(...args),
        createOpenTelemetryService: isTelemetryEnabled
            ? (...args) => new OpenTelemetryService(...args)
            : undefined,
        startTokenReceiver: (...args) => startTokenReceiver(...args),
        otherInitialization: config => {
            return subscriptionDisposable(
                config.subscribe(config => setCustomAgent(config.configuration))
            )
        },
        extensionClient,
    })
}
