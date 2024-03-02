import { FloatingPortal, flip, offset, shift, useFloating } from '@floating-ui/react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
    LexicalTypeaheadMenuPlugin,
    MenuOption,
    type MenuTextMatch,
} from '@lexical/react/LexicalTypeaheadMenuPlugin'
import type { TextNode } from 'lexical'
import { useCallback, useEffect, useMemo, useState } from 'react'
import styles from './atMentions.module.css'

import { type ContextItem, displayPath } from '@sourcegraph/cody-shared'
import classNames from 'classnames'
import { $createMentionNode } from '../../nodes/MentionNode'
import { OptionsList } from './OptionsList'
import { useChatContextClient } from './chatContextClient'

const PUNCTUATION = '\\.,\\+\\*\\?\\$\\@\\|#{}\\(\\)\\^\\-\\[\\]\\\\/!%\'"~=<>_:;'

const ItemMentionsRegex = {
    PUNCTUATION,
}

const PUNC = ItemMentionsRegex.PUNCTUATION

const TRIGGERS = ['@'].join('')

// Chars we expect to see in a mention (non-space, non-punctuation).
const VALID_CHARS = '[^' + TRIGGERS + PUNC + '\\s]'

// Non-standard series of chars. Each series must be preceded and followed by
// a valid char.
const VALID_JOINS =
    '(?:' +
    '\\.[ |$]|' + // E.g. "r. " in "Mr. Smith"
    ' |' + // E.g. " " in "Josh Duck"
    '[' +
    PUNC +
    ']|' + // E.g. "-' in "Salier-Hellendag"
    ')'

const LENGTH_LIMIT = 75

const AtSignMentionsRegex = new RegExp(
    '(^|\\s|\\()(' +
        '[' +
        TRIGGERS +
        ']' +
        '(#(?:' +
        VALID_CHARS +
        VALID_JOINS +
        '){0,' +
        LENGTH_LIMIT +
        '})' +
        ')$'
)

// 50 is the longest alias length limit.
const ALIAS_LENGTH_LIMIT = 50

// Regex used to match alias.
const AtSignMentionsRegexAliasRegex = new RegExp(
    '(^|\\s|\\()(' +
        '[' +
        TRIGGERS +
        ']' +
        '((?:' +
        VALID_CHARS +
        '){0,' +
        ALIAS_LENGTH_LIMIT +
        '})' +
        ')$'
)

const SUGGESTION_LIST_LENGTH_LIMIT = 20

function checkForAtSignMentions(text: string, minMatchLength: number): MenuTextMatch | null {
    let match = AtSignMentionsRegex.exec(text)

    if (match === null) {
        match = AtSignMentionsRegexAliasRegex.exec(text)
    }
    if (match !== null) {
        // The strategy ignores leading whitespace but we need to know it's
        // length to add it to the leadOffset
        const maybeLeadingWhitespace = match[1]

        const matchingString = match[3]
        if (matchingString.length >= minMatchLength) {
            return {
                leadOffset: match.index + maybeLeadingWhitespace.length,
                matchingString,
                replaceableString: match[2],
            }
        }
    }
    return null
}

function getPossibleQueryMatch(text: string): MenuTextMatch | null {
    return checkForAtSignMentions(text, 0)
}

export class MentionTypeaheadOption extends MenuOption {
    public displayPath: string

    constructor(public readonly item: ContextItem) {
        super(
            [
                `${item.type}`,
                `${item.uri.toString()}`,
                `${item.type === 'symbol' ? item.symbolName : ''}`,
                item.range
                    ? `${item.range.start.line}:${item.range.start.character}-${item.range.end.line}:${item.range.end.character}`
                    : '',
            ].join(':')
        )
        this.displayPath = displayPath(item.uri)
    }
}

export function toOptions(items: ContextItem[]): MentionTypeaheadOption[] {
    return items.map(item => new MentionTypeaheadOption(item))
}

export default function MentionsPlugin(): JSX.Element | null {
    const [editor] = useLexicalComposerContext()

    const [query, setQuery] = useState('')

    const { x, y, refs, strategy, update } = useFloating({
        placement: 'top-start',
        middleware: [offset(6), flip(), shift()],
    })

    const chatContextClient = useChatContextClient()
    const [results, setResults] = useState<ContextItem[]>()
    useEffect(() => {
        // Track if the query changed since this request was sent (which would make our results
        // no longer valid).
        let invalidated = false

        if (chatContextClient) {
            chatContextClient
                .getChatContextItems(query)
                .then(mentions => {
                    if (invalidated) {
                        return
                    }
                    setResults(mentions)
                })
                .catch(error => {
                    setResults(undefined)
                    console.error(error)
                })
        }

        return () => {
            invalidated = true
        }
    }, [chatContextClient, query])
    const options = useMemo(
        () =>
            results
                ?.map(result => new MentionTypeaheadOption(result))
                .slice(0, SUGGESTION_LIST_LENGTH_LIMIT) ?? [],
        [results]
    )
    // biome-ignore lint/correctness/useExhaustiveDependencies: Intent is to update whenever `options` changes.
    useEffect(() => {
        update()
    }, [options, update])

    const onSelectOption = useCallback(
        (
            selectedOption: MentionTypeaheadOption,
            nodeToReplace: TextNode | null,
            closeMenu: () => void
        ) => {
            editor.update(() => {
                const mentionNode = $createMentionNode(selectedOption.displayPath)
                if (nodeToReplace) {
                    nodeToReplace.replace(mentionNode)
                }
                mentionNode.select()
                closeMenu()
            })
        },
        [editor]
    )

    const onQueryChange = useCallback((query: string | null) => setQuery(query ?? ''), [])

    return (
        <LexicalTypeaheadMenuPlugin<MentionTypeaheadOption>
            onQueryChange={onQueryChange}
            onSelectOption={onSelectOption}
            triggerFn={getPossibleQueryMatch}
            options={options}
            anchorClassName={styles.resetAnchor}
            onOpen={menuResolution => {
                refs.setPositionReference({
                    getBoundingClientRect: menuResolution.getRect,
                })
            }}
            menuRenderFn={(
                anchorElementRef,
                { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex }
            ) =>
                anchorElementRef.current && (
                    <FloatingPortal root={anchorElementRef.current}>
                        <div
                            ref={refs.setFloating}
                            style={{
                                position: strategy,
                                top: y ?? 0,
                                left: x ?? 0,
                                width: 'max-content',
                            }}
                            className={classNames(styles.popover)}
                        >
                            <OptionsList
                                query={query}
                                options={options}
                                selectedIndex={selectedIndex}
                                setHighlightedIndex={setHighlightedIndex}
                                selectOptionAndCleanUp={selectOptionAndCleanUp}
                            />
                        </div>
                    </FloatingPortal>
                )
            }
        />
    )
}
