import React from 'react'

export interface NodeEditorStandaloneShellProps {
    children: React.ReactNode
    /** 更小的内边距，适合一屏排满（如通用节点编辑） */
    dense?: boolean
}

/**
 * 独立节点编辑 WebView 的内容区：撑满 StandaloneWindowFrame 下方，避免再套一层 DraggableModal 的「假窗口」感。
 * `dark-theme-modal` 复用 index.css 中与主窗口深色弹窗一致的表单/控件字色与输入框样式。
 */
export const NodeEditorStandaloneShell: React.FC<NodeEditorStandaloneShellProps> = ({ children, dense }) => (
    <div
        style={{
            height: '100%',
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            backgroundColor: '#1e1e1e',
        }}
    >
        <div
            className={`dark-theme-modal node-editor-standalone-panel${dense ? ' node-editor-standalone-panel--dense' : ''}`}
            style={{
                flex: 1,
                minHeight: 0,
                // dense：由子节点自行决定滚动区，避免与底部栏双滚动条
                overflow: dense ? 'hidden' : 'auto',
                display: dense ? 'flex' : 'block',
                flexDirection: dense ? 'column' : undefined,
                padding: dense ? '8px 10px' : '8px 12px',
                backgroundColor: '#1f1f1f',
                color: '#e8e8e8',
                boxSizing: 'border-box',
            }}
        >
            {children}
        </div>
    </div>
)
