import type { Model } from '.'
import {
    CHAT_INPUT_TOKEN_BUDGET,
    CHAT_OUTPUT_TOKEN_BUDGET,
    EXTENDED_CHAT_INPUT_TOKEN_BUDGET,
    EXTENDED_USER_CONTEXT_TOKEN_BUDGET,
} from '../token/constants'
import { ModelTag } from './tags'

import { type ModelContextWindow, ModelUsage } from './types'

const basicContextWindow: ModelContextWindow = {
    input: CHAT_INPUT_TOKEN_BUDGET,
    output: CHAT_OUTPUT_TOKEN_BUDGET,
}

/**
 * Has a higher context window with a separate limit for user-context.
 */
const expandedContextWindow: ModelContextWindow = {
    input: EXTENDED_CHAT_INPUT_TOKEN_BUDGET,
    output: CHAT_OUTPUT_TOKEN_BUDGET,
    context: { user: EXTENDED_USER_CONTEXT_TOKEN_BUDGET },
}

/**
 * Returns an array of Models representing the default models for DotCom.
 * The order listed here is the order shown to users. Put the default LLM first.
 *
 * NOTE: The models MUST first be added to the custom chat models list in Cody Gateway.
 * @link https://sourcegraph.com/github.com/sourcegraph/sourcegraph/-/blob/internal/completions/httpapi/chat.go?L48-51
 *
 * @returns An array of `Models` objects.
 * @deprecated This will be replaced with server-sent models
 */
export const DEFAULT_DOT_COM_MODELS = [
    // --------------------------------
    // Anthropic models
    // --------------------------------
    {
        title: 'Claude 3.5 Sonnet',
        id: 'anthropic/claude-3-5-sonnet-20240620',
        provider: 'Anthropic',
        usage: [ModelUsage.Chat, ModelUsage.Edit],
        contextWindow: expandedContextWindow,
        tags: [ModelTag.Gateway, ModelTag.Balanced, ModelTag.Recommended, ModelTag.Free],
    },
    {
        title: 'Claude 3 Opus',
        id: 'anthropic/claude-3-opus-20240229',
        provider: 'Anthropic',
        usage: [ModelUsage.Chat, ModelUsage.Edit],
        contextWindow: expandedContextWindow,
        tags: [ModelTag.Gateway, ModelTag.Pro, ModelTag.Power],
    },
    {
        title: 'Claude 3 Haiku',
        id: 'anthropic/claude-3-haiku-20240307',
        provider: 'Anthropic',
        usage: [ModelUsage.Chat, ModelUsage.Edit],
        contextWindow: basicContextWindow,
        tags: [ModelTag.Gateway, ModelTag.Speed],
    },

    // --------------------------------
    // OpenAI models
    // --------------------------------
    {
        title: 'GPT-4o',
        id: 'openai/gpt-4o',
        provider: 'OpenAI',
        usage: [ModelUsage.Chat, ModelUsage.Edit],
        contextWindow: expandedContextWindow,
        tags: [ModelTag.Gateway, ModelTag.Pro, ModelTag.Balanced],
    },

    // --------------------------------
    // Google models
    // --------------------------------
    {
        title: 'Gemini 1.5 Flash',
        id: 'google/gemini-1.5-flash-latest',
        provider: 'Google',
        usage: [ModelUsage.Chat, ModelUsage.Edit],
        contextWindow: expandedContextWindow,
        tags: [ModelTag.Gateway, ModelTag.Speed],
    },
    {
        title: 'Gemini 1.5 Pro',
        id: 'google/gemini-1.5-pro-latest',
        provider: 'Google',
        usage: [ModelUsage.Chat, ModelUsage.Edit],
        contextWindow: expandedContextWindow,
        tags: [ModelTag.Gateway, ModelTag.Power],
    },

    // TODO (tom) Improve prompt for Mixtral + Edit to see if we can use it there too.
    {
        title: 'Mixtral 8x7B',
        id: 'fireworks/accounts/fireworks/models/mixtral-8x7b-instruct',
        provider: 'Mistral',
        usage: [ModelUsage.Chat],
        contextWindow: basicContextWindow,
        tags: [ModelTag.Gateway, ModelTag.Speed],
    },
    {
        title: 'Mixtral 8x22B',
        id: 'fireworks/accounts/fireworks/models/mixtral-8x22b-instruct',
        provider: 'Mistral',
        usage: [ModelUsage.Chat],
        contextWindow: basicContextWindow,
        tags: [ModelTag.Gateway, ModelTag.Power],
    },
] as const satisfies Model[]

/**
 * Returns an array of Models representing the default models for DotCom.
 *
 * @returns An array of `Models` objects.
 * @deprecated This will be replaced with server-sent models
 */
export function getDotComDefaultModels(): Model[] {
    return DEFAULT_DOT_COM_MODELS
}
