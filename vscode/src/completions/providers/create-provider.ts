import {
    type AuthStatus,
    type CodeCompletionsClient,
    type ConfigurationWithAccessToken,
    FeatureFlag,
    type Model,
    ModelUsage,
    featureFlagProvider,
    modelsService,
} from '@sourcegraph/cody-shared'

import * as vscode from 'vscode'
import { logError } from '../../log'
import { localStorage } from '../../services/LocalStorageProvider'
import {
    type AnthropicOptions,
    DEFAULT_PLG_ANTHROPIC_MODEL,
    createProviderConfig as createAnthropicProviderConfig,
} from './anthropic'
import { createProviderConfig as createExperimentalOllamaProviderConfig } from './experimental-ollama'
import { createProviderConfig as createExperimentalOpenAICompatibleProviderConfig } from './expopenaicompatible'
import {
    DEEPSEEK_CODER_V2_LITE_BASE,
    DEEPSEEK_CODER_V2_LITE_BASE_WINDOW_4096,
    DEEPSEEK_CODER_V2_LITE_BASE_WINDOW_8192,
    DEEPSEEK_CODER_V2_LITE_BASE_WINDOW_16384,
    DEEPSEEK_CODER_V2_LITE_BASE_WINDOW_32768,
    type FireworksOptions,
    createProviderConfig as createFireworksProviderConfig,
} from './fireworks'
import { createProviderConfig as createGeminiProviderConfig } from './google'
import { createProviderConfig as createOpenAICompatibleProviderConfig } from './openaicompatible'
import type { ProviderConfig } from './provider'
import { createProviderConfig as createUnstableOpenAIProviderConfig } from './unstable-openai'

interface CreateConfigHelperParams {
    client: CodeCompletionsClient
    authStatus: AuthStatus
    modelId: string | undefined
    provider: string
    config: ConfigurationWithAccessToken
    model?: Model
}

export async function createProviderConfigHelper(
    params: CreateConfigHelperParams
): Promise<ProviderConfig | null> {
    const { client, authStatus, modelId, model, provider, config } = params

    switch (provider) {
        case 'openai': {
            return createUnstableOpenAIProviderConfig({
                client,
                model: modelId,
            })
        }
        case 'azure-openai': {
            return createUnstableOpenAIProviderConfig({
                client,
                // Model name for azure openai provider is a deployment name. It shouldn't appear in logs.
                model: modelId ? '' : modelId,
            })
        }
        case 'unstable-openai': {
            return createUnstableOpenAIProviderConfig({
                client,
            })
        }
        case 'fireworks': {
            const { anonymousUserID } = await localStorage.anonymousUserID()
            return createFireworksProviderConfig({
                client,
                model: modelId ?? null,
                timeouts: config.autocompleteTimeouts,
                authStatus,
                config,
                anonymousUserID,
            })
        }
        case 'experimental-openaicompatible': {
            // TODO(slimsag): self-hosted-models: deprecate and remove this once customers are upgraded
            // to non-experimental version
            return createExperimentalOpenAICompatibleProviderConfig({
                client,
                model: modelId ?? null,
                timeouts: config.autocompleteTimeouts,
                authStatus,
                config,
            })
        }
        case 'openaicompatible': {
            if (model) {
                return createOpenAICompatibleProviderConfig({
                    client,
                    timeouts: config.autocompleteTimeouts,
                    model,
                    authStatus,
                    config,
                })
            }
            logError(
                'createProviderConfig',
                'Model definition is missing for openaicompatible provider.',
                modelId
            )
            return null
        }
        case 'aws-bedrock':
        case 'anthropic': {
            return createAnthropicProviderConfig({
                client,
                // Only pass through the upstream-defined model if we're using Cody Gateway
                model:
                    authStatus.configOverwrites?.provider === 'sourcegraph'
                        ? authStatus.configOverwrites.completionModel
                        : authStatus.isDotCom
                          ? DEFAULT_PLG_ANTHROPIC_MODEL
                          : undefined,
            })
        }
        case 'google': {
            if (authStatus.configOverwrites?.completionModel?.includes('claude')) {
                return createAnthropicProviderConfig({
                    client,
                    // Model name for google provider is a deployment name. It shouldn't appear in logs.
                    model: undefined,
                })
            }
            // Gemini models
            return createGeminiProviderConfig({ client, model: modelId })
        }
        case 'gemini':
        case 'unstable-gemini': {
            return createGeminiProviderConfig({ client, model: modelId })
        }
        case 'experimental-ollama':
        case 'unstable-ollama': {
            return createExperimentalOllamaProviderConfig(config.autocompleteExperimentalOllamaOptions)
        }
        default:
            logError(
                'createProviderConfig',
                `Unrecognized provider '${config.autocompleteAdvancedProvider}' configured.`
            )
            return null
    }
}

async function resolveFIMModelExperimentFromFeatureFlags(): ReturnType<
    typeof resolveConfigFromFeatureFlags
> {
    /**
     * The traffic allocated to the fine-tuned-base feature flag is further split between multiple feature flag in function.
     */
    const [
        fimModelControl,
        fimModelVariant1,
        fimModelVariant2,
        fimModelVariant3,
        fimModelVariant4,
        fimModelCurrentBest,
    ] = await Promise.all([
        featureFlagProvider.evaluateFeatureFlag(FeatureFlag.CodyAutocompleteFIMModelExperimentControl),
        featureFlagProvider.evaluateFeatureFlag(FeatureFlag.CodyAutocompleteFIMModelExperimentVariant1),
        featureFlagProvider.evaluateFeatureFlag(FeatureFlag.CodyAutocompleteFIMModelExperimentVariant2),
        featureFlagProvider.evaluateFeatureFlag(FeatureFlag.CodyAutocompleteFIMModelExperimentVariant3),
        featureFlagProvider.evaluateFeatureFlag(FeatureFlag.CodyAutocompleteFIMModelExperimentVariant4),
        featureFlagProvider.evaluateFeatureFlag(
            FeatureFlag.CodyAutocompleteFIMModelExperimentCurrentBest
        ),
    ])
    if (fimModelVariant1) {
        // Variant 1: Current production model with +200msec latency to quantity the effect of latency increase while keeping same quality
        return { provider: 'fireworks', model: DEEPSEEK_CODER_V2_LITE_BASE_WINDOW_4096 }
    }
    if (fimModelVariant2) {
        return { provider: 'fireworks', model: DEEPSEEK_CODER_V2_LITE_BASE_WINDOW_8192 }
    }
    if (fimModelVariant3) {
        return { provider: 'fireworks', model: DEEPSEEK_CODER_V2_LITE_BASE_WINDOW_16384 }
    }
    if (fimModelVariant4) {
        return { provider: 'fireworks', model: DEEPSEEK_CODER_V2_LITE_BASE_WINDOW_32768 }
    }
    if (fimModelCurrentBest) {
        return { provider: 'fireworks', model: DEEPSEEK_CODER_V2_LITE_BASE }
    }
    if (fimModelControl) {
        // Current production model
        return { provider: 'fireworks', model: DEEPSEEK_CODER_V2_LITE_BASE }
    }
    // Extra free traffic - redirect to the current production model which could be different than control
    return { provider: 'fireworks', model: DEEPSEEK_CODER_V2_LITE_BASE }
}

interface ProviderConfigFromFeatureFlags {
    provider: string
    model?: FireworksOptions['model'] | AnthropicOptions['model']
}

async function resolveConfigFromFeatureFlags(
    isDotCom: boolean
): Promise<ProviderConfigFromFeatureFlags | null> {
    const [starCoderHybrid, claude3, fimModelExperimentFlag, deepseekV2LiteBase] = await Promise.all([
        featureFlagProvider.evaluateFeatureFlag(FeatureFlag.CodyAutocompleteStarCoderHybrid),
        featureFlagProvider.evaluateFeatureFlag(FeatureFlag.CodyAutocompleteClaude3),
        featureFlagProvider.evaluateFeatureFlag(
            FeatureFlag.CodyAutocompleteFIMModelExperimentBaseFeatureFlag
        ),
        featureFlagProvider.evaluateFeatureFlag(FeatureFlag.CodyAutocompleteDeepseekV2LiteBase),
    ])

    // We run fine tuning experiment for VSC client only.
    // We disable for all agent clients like the JetBrains plugin.
    const isFinetuningExperimentDisabled = vscode.workspace
        .getConfiguration()
        .get<boolean>('cody.advanced.agent.running', false)

    if (!isFinetuningExperimentDisabled && fimModelExperimentFlag && isDotCom) {
        // The traffic in this feature flag is interpreted as a traffic allocated to the fine-tuned experiment.
        return resolveFIMModelExperimentFromFeatureFlags()
    }

    if (isDotCom && deepseekV2LiteBase) {
        return { provider: 'fireworks', model: DEEPSEEK_CODER_V2_LITE_BASE }
    }

    if (starCoderHybrid) {
        return { provider: 'fireworks', model: 'starcoder-hybrid' }
    }

    if (claude3) {
        return { provider: 'anthropic', model: 'anthropic/claude-3-haiku-20240307' }
    }

    return null
}

const delimiters: Record<string, string> = {
    sourcegraph: '/',
    'aws-bedrock': '.',
}

interface AutocompleteModelInfo {
    provider: string
    modelId?: string
    model?: Model
}

function getAutocompleteModelInfo(authStatus: AuthStatus): AutocompleteModelInfo | Error {
    const model = modelsService.getDefaultModel(ModelUsage.Autocomplete)

    if (model) {
        let provider = model.provider
        if (model.clientSideConfig?.openAICompatible) {
            provider = 'openaicompatible'
        }
        return { provider, modelId: model.id, model }
    }

    if (authStatus.configOverwrites?.provider) {
        return parseProviderAndModel({
            provider: authStatus.configOverwrites.provider,
            modelId: authStatus.configOverwrites.completionModel,
        })
    }

    // Fail with error if no `completionModel` is configured.
    return new Error(
        'Failed to get autocomplete model info. Please configure the `completionModel` using site configuration.'
    )
}
/**
 * For certain completions providers configured in the Sourcegraph instance site config
 * the model name consists MODEL_PROVIDER and MODEL_NAME separated by a specific delimiter (see {@link delimiters}).
 *
 * This function checks if the given provider has a specific model naming format and:
 *   - if it does, parses the model name and returns the parsed provider and model names;
 *   - if it doesn't, returns the original provider and model names.
 *
 * E.g. for "sourcegraph" provider the completions model name consists of model provider and model name separated by "/".
 * So when received `{ provider: "sourcegraph", model: "anthropic/claude-instant-1" }` the expected output would be `{ provider: "anthropic", model: "claude-instant-1" }`.
 */
function parseProviderAndModel({
    provider,
    modelId,
}: {
    provider: string
    modelId?: string
}): AutocompleteModelInfo | Error {
    const delimiter = delimiters[provider]
    if (!delimiter) {
        return { provider, modelId }
    }

    if (modelId) {
        const index = modelId.indexOf(delimiter)
        const parsedProvider = modelId.slice(0, index)
        const parsedModel = modelId.slice(index + 1)
        if (parsedProvider && parsedModel) {
            return { provider: parsedProvider, modelId: parsedModel }
        }
    }

    return new Error(
        (modelId
            ? `Failed to parse the model name ${modelId}`
            : `Model missing but delimiter ${delimiter} expected`) +
            `for '${provider}' completions provider.`
    )
}

export async function createProviderConfig(
    config: ConfigurationWithAccessToken,
    client: CodeCompletionsClient,
    authStatus: AuthStatus
): Promise<ProviderConfig | null> {
    // Resolve the provider config from the VS Code config.
    if (config.autocompleteAdvancedProvider) {
        return createProviderConfigHelper({
            client,
            authStatus,
            modelId: config.autocompleteAdvancedModel || undefined,
            provider: config.autocompleteAdvancedProvider,
            config,
        })
    }

    // Check if a user participates in autocomplete model experiments.
    const configFromFeatureFlags = await resolveConfigFromFeatureFlags(authStatus.isDotCom)

    // Use the experiment model if available.
    if (configFromFeatureFlags) {
        return createProviderConfigHelper({
            client,
            authStatus,
            modelId: configFromFeatureFlags.model,
            provider: configFromFeatureFlags.provider,
            config,
        })
    }

    const modelInfoOrError = getAutocompleteModelInfo(authStatus)

    if (modelInfoOrError instanceof Error) {
        logError('createProviderConfig', modelInfoOrError.message)
        return null
    }

    const { provider, modelId, model } = modelInfoOrError

    return createProviderConfigHelper({
        client,
        authStatus,
        modelId,
        model,
        provider,
        config,
    })
}
