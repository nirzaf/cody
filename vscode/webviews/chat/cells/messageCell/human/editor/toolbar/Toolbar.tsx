import type { Model } from '@sourcegraph/cody-shared'
import clsx from 'clsx'
import { AtSignIcon } from 'lucide-react'
import { type FunctionComponent, useCallback } from 'react'
import type { UserAccountInfo } from '../../../../../../Chat'
import { ContextSelectField } from '../../../../../../components/contextSelectField/ContextSelectField'
import { useContexts } from '../../../../../../components/contextSelectField/contexts'
import { ModelSelectField } from '../../../../../../components/modelSelectField/ModelSelectField'
import { ToolbarButton } from '../../../../../../components/shadcn/ui/toolbar'
import { useChatModelContext } from '../../../../../models/chatModelContext'
import { SubmitButton, type SubmitButtonDisabled } from './SubmitButton'
import styles from './Toolbar.module.css'

/**
 * The toolbar for the human message editor.
 */
export const Toolbar: FunctionComponent<{
    userInfo: UserAccountInfo

    isEditorFocused: boolean

    onMentionClick?: () => void

    onSubmitClick: () => void
    submitDisabled: SubmitButtonDisabled

    /** Handler for clicks that are in the "gap" (dead space), not any toolbar items. */
    onGapClick?: () => void

    focusEditor?: () => void

    hidden?: boolean
    className?: string
}> = ({
    userInfo,
    isEditorFocused,
    onMentionClick,
    onSubmitClick,
    submitDisabled,
    onGapClick,
    focusEditor,
    hidden,
    className,
}) => {
    /**
     * If the user clicks in a gap or on the toolbar outside of any of its buttons, report back to
     * parent via {@link onGapClick}.
     */
    const onMaybeGapClick = useCallback(
        (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
            const targetIsToolbarButton = event.target !== event.currentTarget
            if (!targetIsToolbarButton) {
                event.preventDefault()
                event.stopPropagation()
                onGapClick?.()
            }
        },
        [onGapClick]
    )

    return (
        // biome-ignore lint/a11y/useKeyWithClickEvents: only relevant to click areas
        <menu
            role="toolbar"
            aria-hidden={hidden}
            hidden={hidden}
            className={clsx(styles.container, className)}
            onMouseDown={onMaybeGapClick}
            onClick={onMaybeGapClick}
        >
            {onMentionClick && (
                <ToolbarButton
                    variant="secondary"
                    tooltip="Add files and other context"
                    iconStart={AtSignIcon}
                    onClick={onMentionClick}
                    aria-label="Add context"
                />
            )}
            <ContextSelectFieldToolbarItem focusEditor={focusEditor} />
            <ModelSelectFieldToolbarItem userInfo={userInfo} focusEditor={focusEditor} />
            <div className={styles.spacer} />
            <SubmitButton
                onClick={onSubmitClick}
                isEditorFocused={isEditorFocused}
                disabled={submitDisabled}
            />
        </menu>
    )
}

const ContextSelectFieldToolbarItem: FunctionComponent<{
    focusEditor?: () => void
    className?: string
}> = ({ focusEditor, className }) => {
    const contexts = useContexts()
    return (
        contexts && (
            <>
                {toolbarItemBorder}
                <ContextSelectField
                    contexts={contexts.contexts}
                    currentContext={contexts.currentContext}
                    onCurrentContextChange={contexts.onCurrentContextChange}
                    onCloseByEscape={focusEditor}
                    className={className}
                />
            </>
        )
    )
}

const ModelSelectFieldToolbarItem: FunctionComponent<{
    userInfo: UserAccountInfo
    focusEditor?: () => void
    className?: string
}> = ({ userInfo, focusEditor, className }) => {
    const { chatModels, onCurrentChatModelChange } = useChatModelContext()

    const onModelSelect = useCallback(
        (model: Model) => {
            onCurrentChatModelChange?.(model)
            focusEditor?.()
        },
        [onCurrentChatModelChange, focusEditor]
    )

    return (
        !!chatModels?.length &&
        onCurrentChatModelChange &&
        userInfo &&
        userInfo.isDotComUser && (
            <>
                {toolbarItemBorder}
                <ModelSelectField
                    models={chatModels}
                    onModelSelect={onModelSelect}
                    userInfo={userInfo}
                    onCloseByEscape={focusEditor}
                    className={className}
                />
            </>
        )
    )
}

const toolbarItemBorder = (
    <div className="tw-ml-[5px] tw-mr-[5px] tw-border-l-[1px] tw-border-white tw-h-6 tw-opacity-10" />
)
