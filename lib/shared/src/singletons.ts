const NOT_YET_SET = { __singletonNotYetSet: true } as const

type Singleton<T> = T | typeof NOT_YET_SET

export function singletonNotYetSet<T>(): T {
    return { __singletonNotYetSet: true } as T
}

export function setSingleton<T extends object>(container: Singleton<T>, instance: T): T {
    if (!('__singletonNotYetSet' in container)) {
        throw new Error('singleton already set')
    }
    // biome-ignore lint/performance/noDelete:
    delete (container as any).__singletonNotYetSet
    deepAssign(container as any, instance)
    return instance
}

function deepAssign<T extends object>(target: T, source: T): void {
    Object.setPrototypeOf(target, Object.getPrototypeOf(source))
    for (const key in source) {
        if (Object.prototype.hasOwnProperty.call(source, key)) {
            const desc = Object.getOwnPropertyDescriptor(source, key)
            if (desc) {
                Object.defineProperty(target, key, desc)
            } else {
                target[key] = source[key]
            }
        }
    }
}
