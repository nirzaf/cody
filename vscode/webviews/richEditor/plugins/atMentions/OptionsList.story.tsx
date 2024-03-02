import type { Meta, StoryObj } from '@storybook/react'
import { URI } from 'vscode-uri'

import { VSCodeStoryDecorator } from '../../../storybook/VSCodeStoryDecorator'
import { OptionsList } from './OptionsList'
import { toOptions } from './atMentions'

const meta: Meta<typeof OptionsList> = {
    title: 'cody/OptionsList',
    component: OptionsList,

    args: {
        query: '',
        options: [],
        selectedIndex: null,
        selectOptionAndCleanUp: () => {},
        setHighlightedIndex: () => {},
    } as React.ComponentProps<typeof OptionsList>,

    decorators: [
        story => {
            return (
                <div
                    style={{
                        background: 'var(--vscode-editor-background)',
                        color: 'var(--vscode-editor-foreground)',
                    }}
                >
                    {story()}
                </div>
            )
        },
        VSCodeStoryDecorator,
    ],
}

export default meta

export const FileSearchEmpty: StoryObj<typeof OptionsList> = {
    args: {
        query: '',
        options: toOptions([]),
    },
}

export const FileSearchNoMatches: StoryObj<typeof OptionsList> = {
    args: {
        query: 'missing',
        options: toOptions([]),
    },
}

export const FileSearchMatches: StoryObj<typeof OptionsList> = {
    args: {
        query: 'd',
        options: toOptions(
            Array.from(new Array(10).keys()).map(i => ({
                uri: URI.file(`${i ? `${'sub-dir/'.repeat(i * 5)}/` : ''}file-${i}.py`),
                type: 'file',
            }))
        ),
    },
}

export const LongScrolling: StoryObj<typeof OptionsList> = {
    args: {
        query: 'd',
        options: toOptions(
            Array.from(new Array(20).keys()).map(i => ({
                uri: URI.file(`${i ? `${'dir/'.repeat(i + 1)}` : ''}file-${i}.py`),
                type: 'file',
            }))
        ),
    },
}

export const SymbolSearchNoMatches: StoryObj<typeof OptionsList> = {
    args: {
        query: '#a',
        options: toOptions([]),
    },
}

export const SymbolSearchNoMatchesWarning: StoryObj<typeof OptionsList> = {
    args: {
        query: '#abcdefg',
        options: toOptions([]),
    },
}

export const SymbolSearchMatches: StoryObj<typeof OptionsList> = {
    args: {
        query: '#login',
        options: toOptions([
            {
                symbolName: 'LoginDialog',
                type: 'symbol',
                kind: 'class',
                uri: URI.file('/lib/src/LoginDialog.tsx'),
            },
            {
                symbolName: 'login',
                type: 'symbol',
                kind: 'function',
                uri: URI.file('/src/login.go'),
                range: { start: { line: 42, character: 1 }, end: { line: 44, character: 1 } },
            },
            {
                symbolName: 'handleLogin',
                type: 'symbol',
                kind: 'method',
                uri: URI.file(`/${'sub-dir/'.repeat(50)}/}/src/LoginDialog.tsx`),
            },
            {
                symbolName: 'handleLogin',
                type: 'symbol',
                kind: 'method',
                uri: URI.file(`/${'sub-dir/'.repeat(50)}/}/src/LoginDialog.tsx`),
            },
            {
                symbolName: 'handleLogin',
                type: 'symbol',
                kind: 'method',
                uri: URI.file(`/${'sub-dir/'.repeat(50)}/}/src/LoginDialog.tsx`),
            },
            {
                symbolName: 'handleLogin',
                type: 'symbol',
                kind: 'method',
                uri: URI.file(`/${'sub-dir/'.repeat(50)}/}/src/LoginDialog.tsx`),
            },
            {
                symbolName: 'handleLogin',
                type: 'symbol',
                kind: 'method',
                uri: URI.file(`/${'sub-dir/'.repeat(50)}/}/src/LoginDialog.tsx`),
            },
        ]),
    },
}
