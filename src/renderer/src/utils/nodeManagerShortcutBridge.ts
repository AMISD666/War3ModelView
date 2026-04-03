/**
 * 在全局快捷键分发之前优先处理「节点管理器 + Delete」，
 * 避免时间轴/多边形组等 Delete 绑定先执行，以及 blur 抢焦点导致 contains 失败。
 */

type NodeManagerDeleteListener = (event: KeyboardEvent) => boolean

let listener: NodeManagerDeleteListener | null = null

/** 由 NodeManagerWindow 挂载时注册，卸载时清空 */
export function registerNodeManagerDeleteKeyListener(fn: NodeManagerDeleteListener): () => void {
    listener = fn
    return () => {
        listener = null
    }
}

/** 在 handleGlobalShortcutKeyDown 最前面调用；若已消费则不再走时间轴等 Delete */
export function tryConsumeNodeManagerDeleteKey(event: KeyboardEvent): boolean {
    if (event.key !== 'Delete' && event.code !== 'Delete') {
        return false
    }
    return listener?.(event) ?? false
}
