import {
    type ChatMessage,
    type Guardrails,
    type SerializedPromptEditorValue,
    deserializeContextItem,
    isAbortErrorOrSocketHangUp,
} from '@sourcegraph/cody-shared'
import { type PromptEditorRefAPI, useExtensionAPI } from '@sourcegraph/prompt-editor'
import { debounce } from 'lodash'
import isEqual from 'lodash/isEqual'
import { Search } from 'lucide-react'
import { type FC, memo, useCallback, useMemo, useRef, useState } from 'react'
import type { UserAccountInfo } from '../Chat'
import type { ApiPostMessage } from '../Chat'
import { Button } from '../components/shadcn/ui/button'
import { getVSCodeAPI } from '../utils/VSCodeApi'
import type { CodeBlockActionsProps } from './ChatMessageContent/ChatMessageContent'
import { ContextCell } from './cells/contextCell/ContextCell'
import {
    AssistantMessageCell,
    makeHumanMessageInfo,
} from './cells/messageCell/assistant/AssistantMessageCell'
import { HumanMessageCell } from './cells/messageCell/human/HumanMessageCell'
import { CodyIcon } from './components/CodyIcon'
import { InfoMessage } from './components/InfoMessage'

interface TranscriptProps {
    chatEnabled: boolean
    transcript: ChatMessage[]
    userInfo: UserAccountInfo
    messageInProgress: ChatMessage | null

    guardrails?: Guardrails
    postMessage?: ApiPostMessage
    isTranscriptError?: boolean

    feedbackButtonsOnSubmit: (text: string) => void
    copyButtonOnSubmit: CodeBlockActionsProps['copyButtonOnSubmit']
    insertButtonOnSubmit?: CodeBlockActionsProps['insertButtonOnSubmit']
    smartApply?: CodeBlockActionsProps['smartApply']
    smartApplyEnabled?: boolean
    experimentalOneBoxEnabled?: boolean
}

export const Transcript: FC<TranscriptProps> = props => {
    const {
        chatEnabled,
        transcript,
        userInfo,
        messageInProgress,
        guardrails,
        postMessage,
        isTranscriptError,
        feedbackButtonsOnSubmit,
        copyButtonOnSubmit,
        insertButtonOnSubmit,
        smartApply,
        smartApplyEnabled,
        experimentalOneBoxEnabled,
    } = props

    const interactions = useMemo(
        () => transcriptToInteractionPairs(transcript, messageInProgress),
        [transcript, messageInProgress]
    )

    return (
        <div className="tw-px-6 tw-pt-8 tw-pb-12 tw-flex tw-flex-col tw-gap-8">
            {interactions.map((interaction, i) => (
                <TranscriptInteraction
                    // biome-ignore lint/suspicious/noArrayIndexKey: <explanation>
                    key={i}
                    chatEnabled={chatEnabled}
                    userInfo={userInfo}
                    interaction={interaction}
                    guardrails={guardrails}
                    postMessage={postMessage}
                    isTranscriptError={isTranscriptError}
                    feedbackButtonsOnSubmit={feedbackButtonsOnSubmit}
                    copyButtonOnSubmit={copyButtonOnSubmit}
                    insertButtonOnSubmit={insertButtonOnSubmit}
                    isFirstInteraction={i === 0}
                    isLastInteraction={i === interactions.length - 1}
                    isLastSentInteraction={
                        i === interactions.length - 2 && interaction.assistantMessage !== null
                    }
                    priorAssistantMessageIsLoading={Boolean(
                        messageInProgress && interactions.at(i - 1)?.assistantMessage?.isLoading
                    )}
                    smartApply={smartApply}
                    smartApplyEnabled={smartApplyEnabled}
                    experimentalOneBoxEnabled={experimentalOneBoxEnabled}
                />
            ))}
        </div>
    )
}

/** A human-assistant message-and-response pair. */
export interface Interaction {
    /** The human message, either sent or not. */
    humanMessage: ChatMessage & { index: number; isUnsentFollowup: boolean }

    /** `null` if the {@link Interaction.humanMessage} has not yet been sent. */
    assistantMessage: (ChatMessage & { index: number; isLoading: boolean }) | null
}

export function transcriptToInteractionPairs(
    transcript: ChatMessage[],
    assistantMessageInProgress: ChatMessage | null
): Interaction[] {
    const pairs: Interaction[] = []
    const transcriptLength = transcript.length

    for (let i = 0; i < transcriptLength; i += 2) {
        const humanMessage = transcript[i]
        if (humanMessage.speaker !== 'human') continue

        const isLastPair = i === transcriptLength - 1
        const assistantMessage = isLastPair ? assistantMessageInProgress : transcript[i + 1]

        const isLoading =
            assistantMessage &&
            assistantMessage.error === undefined &&
            assistantMessageInProgress &&
            (isLastPair || assistantMessage.text === undefined)

        pairs.push({
            humanMessage: { ...humanMessage, index: i, isUnsentFollowup: false },
            assistantMessage: assistantMessage
                ? { ...assistantMessage, index: i + 1, isLoading: !!isLoading }
                : null,
        })
    }

    const lastAssistantMessage = pairs[pairs.length - 1]?.assistantMessage
    const isAborted = isAbortErrorOrSocketHangUp(lastAssistantMessage?.error)
    const shouldAddFollowup =
        lastAssistantMessage &&
        (!lastAssistantMessage.error ||
            (isAborted && lastAssistantMessage.text) ||
            (!assistantMessageInProgress && lastAssistantMessage.text))

    if (!transcript.length || shouldAddFollowup) {
        pairs.push({
            humanMessage: { index: pairs.length * 2, speaker: 'human', isUnsentFollowup: true },
            assistantMessage: null,
        })
    }

    return pairs
}

interface TranscriptInteractionProps
    extends Omit<TranscriptProps, 'transcript' | 'messageInProgress' | 'chatID'> {
    interaction: Interaction
    isFirstInteraction: boolean
    isLastInteraction: boolean
    isLastSentInteraction: boolean
    priorAssistantMessageIsLoading: boolean
}

const TranscriptInteraction: FC<TranscriptInteractionProps> = memo(props => {
    const {
        interaction: { humanMessage, assistantMessage },
        isFirstInteraction,
        isLastInteraction,
        isLastSentInteraction,
        priorAssistantMessageIsLoading,
        isTranscriptError,
        userInfo,
        chatEnabled,
        feedbackButtonsOnSubmit,
        postMessage,
        guardrails,
        insertButtonOnSubmit,
        copyButtonOnSubmit,
        smartApply,
        smartApplyEnabled,
        experimentalOneBoxEnabled,
    } = props

    const [intent, setIntent] = useState<ChatMessage['intent']>()
    const humanEditorRef = useRef<PromptEditorRefAPI | null>(null)

    const onEditSubmit = useCallback(
        (editorValue: SerializedPromptEditorValue, intentFromSubmit?: ChatMessage['intent']): void => {
            editHumanMessage(humanMessage.index, editorValue, intentFromSubmit || intent)
        },
        [humanMessage, intent]
    )

    const onFollowupSubmit = useCallback(
        (editorValue: SerializedPromptEditorValue, intentFromSubmit?: ChatMessage['intent']): void => {
            submitHumanMessage(editorValue, intentFromSubmit || intent)
        },
        [intent]
    )

    const extensionAPI = useExtensionAPI()

    const onChange = useMemo(() => {
        return debounce(async (editorValue: SerializedPromptEditorValue) => {
            if (!experimentalOneBoxEnabled) {
                return
            }

            // Only detect intent if a repository is mentioned
            if (
                editorValue.contextItems.find(contextItem =>
                    ['repository', 'tree'].includes(contextItem.type)
                )
            ) {
                setIntent(undefined)
                extensionAPI.detectIntent(editorValue.text).subscribe(value => {
                    setIntent(value)
                })
            }
        }, 500)
    }, [experimentalOneBoxEnabled, extensionAPI])

    const onStop = useCallback(() => {
        getVSCodeAPI().postMessage({
            command: 'abort',
        })
    }, [])

    const isContextLoading = Boolean(
        humanMessage.contextFiles === undefined &&
            isLastSentInteraction &&
            assistantMessage?.text === undefined
    )

    const reSubmitWithIntent = useCallback(
        (intent: ChatMessage['intent']) => {
            onStop()
            const editorState = humanEditorRef.current?.getSerializedValue()
            if (editorState) {
                onEditSubmit(editorState, intent)
            }
        },
        [onStop, onEditSubmit]
    )

    const reSubmitWithChatIntent = useCallback(() => reSubmitWithIntent('chat'), [reSubmitWithIntent])
    const reSubmitWithSearchIntent = useCallback(
        () => reSubmitWithIntent('search'),
        [reSubmitWithIntent]
    )

    return (
        <>
            <HumanMessageCell
                key={humanMessage.index}
                userInfo={userInfo}
                chatEnabled={chatEnabled}
                message={humanMessage}
                isFirstMessage={humanMessage.index === 0}
                isSent={!humanMessage.isUnsentFollowup}
                isPendingPriorResponse={priorAssistantMessageIsLoading}
                onChange={onChange}
                onSubmit={humanMessage.isUnsentFollowup ? onFollowupSubmit : onEditSubmit}
                onStop={onStop}
                isFirstInteraction={isFirstInteraction}
                isLastInteraction={isLastInteraction}
                isEditorInitiallyFocused={isLastInteraction}
                editorRef={humanEditorRef}
                experimentalOneBoxEnabled={experimentalOneBoxEnabled}
            />
            {experimentalOneBoxEnabled && humanMessage.intent && (
                <InfoMessage>
                    {humanMessage.intent === 'search' ? (
                        <div className="tw-flex tw-justify-between tw-gap-4">
                            <p>Intent detection selected a code search response.</p>
                            <div>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="tw-text-prmary tw-flex tw-gap-2 tw-items-center"
                                    onClick={reSubmitWithChatIntent}
                                >
                                    <CodyIcon className="tw-text-link" />
                                    Ask the LLM
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <div className="tw-flex tw-justify-between tw-gap-4">
                            <p>Intent detection selected an LLM response.</p>
                            <div>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="tw-text-prmary tw-flex tw-gap-2 tw-items-center"
                                    onClick={reSubmitWithSearchIntent}
                                >
                                    <Search className="tw-size-8 tw-text-link" />
                                    Search Code
                                </Button>
                            </div>
                        </div>
                    )}
                </InfoMessage>
            )}
            {((humanMessage.contextFiles && humanMessage.contextFiles.length > 0) ||
                isContextLoading) && (
                <ContextCell
                    key={`${humanMessage.index}-${humanMessage.intent}-context`}
                    contextItems={humanMessage.contextFiles}
                    contextAlternatives={humanMessage.contextAlternatives}
                    model={assistantMessage?.model}
                    isForFirstMessage={humanMessage.index === 0}
                    defaultOpen={experimentalOneBoxEnabled && humanMessage.intent === 'search'}
                />
            )}
            {assistantMessage && !isContextLoading && (
                <AssistantMessageCell
                    key={assistantMessage.index}
                    userInfo={userInfo}
                    chatEnabled={chatEnabled}
                    message={assistantMessage}
                    feedbackButtonsOnSubmit={feedbackButtonsOnSubmit}
                    copyButtonOnSubmit={copyButtonOnSubmit}
                    insertButtonOnSubmit={insertButtonOnSubmit}
                    postMessage={postMessage}
                    guardrails={guardrails}
                    humanMessage={makeHumanMessageInfo(
                        { humanMessage, assistantMessage },
                        humanEditorRef
                    )}
                    isLoading={assistantMessage.isLoading}
                    showFeedbackButtons={
                        !assistantMessage.isLoading &&
                        !isTranscriptError &&
                        !assistantMessage.error &&
                        isLastSentInteraction
                    }
                    smartApply={smartApply}
                    smartApplyEnabled={smartApplyEnabled}
                />
            )}
        </>
    )
}, isEqual)

// TODO(sqs): Do this the React-y way.
export function focusLastHumanMessageEditor(): void {
    const elements = document.querySelectorAll<HTMLElement>('[data-lexical-editor]')
    const lastEditor = elements.item(elements.length - 1)
    lastEditor?.focus()
}

export function editHumanMessage(
    messageIndexInTranscript: number,
    editorValue: SerializedPromptEditorValue,
    intent?: ChatMessage['intent']
): void {
    getVSCodeAPI().postMessage({
        command: 'edit',
        index: messageIndexInTranscript,
        text: editorValue.text,
        editorState: editorValue.editorState,
        contextFiles: editorValue.contextItems.map(deserializeContextItem),
        intent,
    })
    focusLastHumanMessageEditor()
}

function submitHumanMessage(
    editorValue: SerializedPromptEditorValue,
    intent?: ChatMessage['intent']
): void {
    getVSCodeAPI().postMessage({
        command: 'submit',
        submitType: 'user',
        text: editorValue.text,
        editorState: editorValue.editorState,
        contextFiles: editorValue.contextItems.map(deserializeContextItem),
        intent,
    })
    focusLastHumanMessageEditor()
}
