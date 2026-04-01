/**
 * 节点管理器树列表是否在选中变化时自动滚动到当前节点。
 * 仅在视口点击选中节点时调用 markNodeManagerListScrollFromViewer()；
 * 节点管理器树内或其它 UI 选中前应调用 markNodeManagerListScrollFromTree() 以禁止滚动。
 */

export let shouldScrollNodeManagerToSelection = false

export function markNodeManagerListScrollFromViewer(): void {
  shouldScrollNodeManagerToSelection = true
}

export function markNodeManagerListScrollFromTree(): void {
  shouldScrollNodeManagerToSelection = false
}
