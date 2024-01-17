import { useArgs, useState } from '@storybook/preview-api'
import { type Meta, type StoryObj } from '@storybook/react'

import {
    type ContextProvider,
    type LocalEmbeddingsProvider,
    type SearchProvider,
} from '@sourcegraph/cody-shared/src/codebase-context/context-status'

import { VSCodeStoryDecorator } from '../storybook/VSCodeStoryDecorator'

import {
    EnhancedContextContext,
    EnhancedContextEventHandlers,
    EnhancedContextPresentationMode,
    EnhancedContextSettings,
    type EnhancedContextEventHandlersT,
} from './EnhancedContextSettings'

const meta: Meta<typeof EnhancedContextSettings> = {
    title: 'cody/Enhanced Context',
    component: EnhancedContextSettings,
    decorators: [VSCodeStoryDecorator],
    parameters: {
        backgrounds: {
            default: 'vscode',
            values: [
                {
                    name: 'vscode',
                    value: 'var(--vscode-sideBar-background)',
                },
            ],
        },
    },
}

export default meta

interface SingleTileArgs {
    isOpen: boolean
    presentationMode: EnhancedContextPresentationMode
    name: string
    kind: 'embeddings' | 'search'
    type: 'local' | 'remote'
    state: 'indeterminate' | 'unconsented' | 'indexing' | 'ready' | 'no-match'
    id: string
    inclusion: 'auto' | 'manual'
}

export const SingleTile: StoryObj<typeof EnhancedContextSettings | SingleTileArgs> = {
    args: {
        presentationMode: EnhancedContextPresentationMode.Consumer,
        isOpen: true,
        name: '~/sourcegraph',
        kind: 'search',
        type: 'local',
        state: 'ready',
    },
    argTypes: {
        presentationMode: {
            options: ['consumer', 'enterprise'],
            control: 'radio',
        },
        isOpen: { control: 'boolean' },
        name: { control: 'text' },
        kind: {
            options: ['embeddings', 'search'],
            control: 'radio',
        },
        type: {
            options: ['local', 'remote'],
            control: 'radio',
            if: {
                arg: 'kind',
                eq: 'search',
            },
        },
        state: {
            options: ['indeterminate', 'unconsented', 'indexing', 'ready', 'no-match'],
            control: 'select',
        },
        id: { control: 'text' },
        inclusion: {
            options: ['auto', 'manual'],
            control: 'radio',
        },
    },
    render: function Render() {
        const [args, updateArgs] = useArgs<SingleTileArgs>()
        const [isOpen, setIsOpen] = useState<boolean>(args.isOpen)

        const eventHandlers: EnhancedContextEventHandlersT = {
            onConsentToEmbeddings(provider: LocalEmbeddingsProvider): void {
                updateArgs({ state: 'indexing' })
            },
            onShouldBuildSymfIndex(provider: SearchProvider): void {
                updateArgs({ state: 'indexing' })
            },
            onEnabledChange(enabled: boolean): void {
                console.log(`Thank you for ${enabled ? 'enabling' : 'disabling'} the enhanced context!`)
            },
        }

        return (
            <EnhancedContextContext.Provider
                value={{
                    groups: [
                        {
                            name: args.name,
                            providers: [
                                // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
                                {
                                    kind: args.kind,
                                    type: args.type,
                                    state: args.state,
                                    name: args.name,
                                    id: args.id,
                                    inclusion: args.inclusion,
                                } as ContextProvider,
                            ],
                        },
                    ],
                }}
            >
                <EnhancedContextEventHandlers.Provider value={eventHandlers}>
                    <div
                        style={{
                            position: 'absolute',
                            bottom: 20,
                            right: 20,
                        }}
                    >
                        <EnhancedContextSettings
                            isOpen={isOpen}
                            setOpen={() => setIsOpen(!isOpen)}
                            presentationMode={args.presentationMode}
                        />
                    </div>
                </EnhancedContextEventHandlers.Provider>
            </EnhancedContextContext.Provider>
        )
    },
}

export const ConsumerMultipleProviders: StoryObj<typeof EnhancedContextSettings> = {
    render: function Render() {
        const [isOpen, setIsOpen] = useState<boolean>(true)
        return (
            <EnhancedContextContext.Provider
                value={{
                    groups: [
                        {
                            name: '~/projects/foo',
                            providers: [
                                { kind: 'embeddings', state: 'unconsented' },
                                { kind: 'search', type: 'local', state: 'indexing' },
                            ],
                        },
                    ],
                }}
            >
                <div
                    style={{
                        position: 'absolute',
                        bottom: 20,
                        right: 20,
                    }}
                >
                    <EnhancedContextSettings
                        isOpen={isOpen}
                        setOpen={() => setIsOpen(!isOpen)}
                        presentationMode={EnhancedContextPresentationMode.Consumer}
                    />
                </div>
            </EnhancedContextContext.Provider>
        )
    },
}

export const EnterpriseMultipleRepositories: StoryObj<typeof EnhancedContextSettings> = {
    render: function Render() {
        const [isOpen, setIsOpen] = useState<boolean>(true)
        return (
            <EnhancedContextContext.Provider
                value={{
                    groups: [
                        {
                            name: 'github.com/megacorp/foo',
                            providers: [
                                { kind: 'search', type: 'remote', state: 'ready', id: 'pqrxy', inclusion: 'manual' },
                            ],
                        },
                        {
                            name: 'github.com/megacorp/bar',
                            providers: [
                                { kind: 'search', type: 'remote', state: 'ready', id: 'xgzwa', inclusion: 'auto' },
                            ],
                        },
                        {
                            name: 'github.com/megacorp/handbook',
                            providers: [
                                { kind: 'search', type: 'remote', state: 'ready', id: 'pffty', inclusion: 'manual' },
                            ],
                        },
                    ],
                }}
            >
                <div
                    style={{
                        position: 'absolute',
                        bottom: 20,
                        right: 20,
                    }}
                >
                    <EnhancedContextSettings
                        presentationMode={EnhancedContextPresentationMode.Enterprise}
                        isOpen={isOpen}
                        setOpen={() => setIsOpen(!isOpen)}
                    />
                </div>
            </EnhancedContextContext.Provider>
        )
    },
}
