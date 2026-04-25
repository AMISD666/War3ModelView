import { appModal } from '../store/messageStore'
﻿import React, { useEffect, useMemo, useState } from 'react'
import { Button, Modal, Tag, Typography, Tooltip } from 'antd'
import { shortcutActions, ShortcutAction } from '../shortcuts/actions'
import { getDefaultBindings, useShortcutStore } from '../store/shortcutStore'
import { formatKeyCombo, normalizeKeyCombo, normalizeKeyComboFromEvent } from '../shortcuts/utils'
import { UndoOutlined, DeleteOutlined, EditOutlined, GlobalOutlined, EyeOutlined, BuildOutlined, ScissorOutlined, PlayCircleOutlined, BlockOutlined } from '@ant-design/icons'

const { Text, Title } = Typography

// --- Styles ---

const containerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    padding: '8px 4px',
    height: '100%',
    overflowY: 'auto',
    overflowX: 'hidden'
}

const headerStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 16px',
    background: 'rgba(255, 255, 255, 0.02)',
    backdropFilter: 'blur(8px)',
    border: '1px solid rgba(255, 255, 255, 0.05)',
    borderRadius: '10px',
    position: 'sticky',
    top: 0,
    zIndex: 10
}

const sectionStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    marginBottom: '8px'
}

const sectionTitleStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '12px',
    fontWeight: 700,
    color: '#1890ff',
    textTransform: 'uppercase',
    letterSpacing: '1px',
    padding: '4px 8px',
    background: 'rgba(24, 144, 255, 0.05)',
    borderRadius: '4px',
    margin: '8px 0 4px 0'
}

const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '6px'
}

const itemStyle = (isEditing: boolean): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '6px 10px',
    background: isEditing
        ? 'rgba(24, 144, 255, 0.12)'
        : 'rgba(255, 255, 255, 0.01)',
    border: isEditing
        ? '1px solid rgba(24, 144, 255, 0.4)'
        : '1px solid rgba(255, 255, 255, 0.03)',
    borderRadius: '6px',
    transition: 'all 0.2s ease',
    height: '32px',
    boxShadow: isEditing ? '0 0 12px rgba(24, 144, 255, 0.15)' : 'none',
    position: 'relative'
})

const labelStyle: React.CSSProperties = {
    fontSize: '12px',
    color: '#ccc',
    fontWeight: 400,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: '50%'
}

const shortcutZoneStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    justifyContent: 'flex-end',
    flex: 1,
    minWidth: 0
}

const tagStyle = (isEditing: boolean): React.CSSProperties => ({
    margin: 0,
    padding: '0 6px',
    height: '20px',
    lineHeight: '18px',
    background: isEditing ? '#1890ff' : 'rgba(255, 255, 255, 0.03)',
    border: isEditing ? 'none' : '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: '3px',
    color: isEditing ? '#fff' : '#888',
    fontSize: '10px',
    fontFamily: '"SF Mono", "Fira Code", monospace',
    textAlign: 'center'
})

const iconGroupStyle: React.CSSProperties = {
    display: 'flex',
    gap: '2px',
    marginLeft: '4px',
    borderLeft: '1px solid rgba(255,255,255,0.05)',
    paddingLeft: '4px'
}

const miniButtonStyle: React.CSSProperties = {
    fontSize: '10px',
    width: '20px',
    height: '20px',
    padding: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
}

// --- Grouping Logic ---

const customGroupActions = new Set([
    'animation.selectParentNode',
    'animation.selectChildNode'
])

const getGroupTitleMap = (category: string): string => {
    switch (category) {
        case '文件':
        case '窗口':
        case '编辑器':
        case '编辑':
        case '模式':
            return '通用快捷键'
        case '视图':
            return '查看状态'
        case '变换':
        case '多边形组':
            return '顶点编辑'
        case 'UV':
            return 'UV 编辑'
        case '动画':
        case '时间轴':
            return '动画编辑'
        case '批量':
            return '批量处理'
        default:
            return '其他'
    }
}

const getGroupIcon = (title: string) => {
    switch (title) {
        case '通用快捷键': return <GlobalOutlined />
        case '查看状态': return <EyeOutlined />
        case '顶点编辑': return <BuildOutlined />
        case 'UV 编辑': return <ScissorOutlined />
        case '动画编辑': return <PlayCircleOutlined />
        case '批量处理': return <BlockOutlined />
        default: return <GlobalOutlined />
    }
}

// --- Helpers ---

const getEffectiveBindings = (bindings: Record<string, string[]>, actionId: string): string[] => {
    const override = bindings[actionId]
    if (override) return override
    return getDefaultBindings(actionId)
}

const hasContextOverlap = (a: ShortcutAction, b: ShortcutAction): boolean => {
    return a.contexts.some((ctx) => b.contexts.includes(ctx))
}

// --- Component ---

export const ShortcutSettingsPanel: React.FC = () => {
    const { bindings, setBindings, clearBindings, resetAll } = useShortcutStore()
    const [editingActionId, setEditingActionId] = useState<string | null>(null)

    const groupedActions = useMemo(() => {
        const groups = new Map<string, ShortcutAction[]>()

        // Ensure specific order
        const groupTitles = ['通用快捷键', '查看状态', '顶点编辑', 'UV 编辑', '动画编辑', '批量处理']
        groupTitles.forEach(t => groups.set(t, []))

        for (const action of shortcutActions) {
            const title = customGroupActions.has(action.id)
                ? '通用快捷键'
                : getGroupTitleMap(action.category)
            if (!groups.has(title)) groups.set(title, [])
            groups.get(title)!.push(action)
        }

        return Array.from(groups.entries()).filter(([_, actions]) => actions.length > 0)
    }, [])

    useEffect(() => {
        if (!editingActionId) return

        const handleCapture = (e: KeyboardEvent) => {
            e.preventDefault()
            e.stopPropagation()
            if (typeof e.stopImmediatePropagation === 'function') {
                e.stopImmediatePropagation()
            }

            if (e.key === 'Escape') {
                setEditingActionId(null)
                return
            }

            const combo = normalizeKeyComboFromEvent(e)
            if (!combo) return
            const normalizedCombo = normalizeKeyCombo(combo)

            const actionId = editingActionId
            const currentAction = shortcutActions.find((action) => action.id === actionId)
            if (!currentAction) {
                setEditingActionId(null)
                return
            }

            const conflict = shortcutActions.find((action) => {
                if (action.id === editingActionId) return false
                if (!hasContextOverlap(action, currentAction)) return false
                const effective = getEffectiveBindings(bindings, action.id).map(normalizeKeyCombo)
                return effective.some((binding) => binding === normalizedCombo)
            })

            const applyBinding = () => {
                setBindings(actionId, [normalizedCombo])
                setEditingActionId(null)
            }

            if (conflict) {
                setEditingActionId(null)
                appModal.confirm({
                    title: '快捷键冲突',
                    content: `「${conflict.label}」已使用 ${formatKeyCombo(combo)}。是否覆盖？`,
                    okText: '覆盖',
                    cancelText: '取消',
                    centered: true,
                    className: 'dark-theme-modal',
                    onOk: () => {
                        const next = getEffectiveBindings(bindings, conflict.id)
                            .filter((binding) => normalizeKeyCombo(binding) !== normalizedCombo)
                        setBindings(conflict.id, next)
                        applyBinding()
                    }
                })
            } else {
                applyBinding()
            }
        }

        window.addEventListener('keydown', handleCapture, true)
        return () => window.removeEventListener('keydown', handleCapture, true)
    }, [bindings, editingActionId, setBindings])

    return (
        <div style={containerStyle}>
            {groupedActions.map(([title, actions]) => (
                <div key={title} style={sectionStyle}>
                    <div style={sectionTitleStyle}>
                        {getGroupIcon(title)}
                        {title}
                    </div>
                    <div style={gridStyle}>
                        {actions.map((action) => {
                            const isEditing = editingActionId === action.id
                            const effectiveBindings = getEffectiveBindings(bindings, action.id)

                            return (
                                <div
                                    key={action.id}
                                    style={itemStyle(isEditing)}
                                    className="shortcut-item"
                                >
                                    <Tooltip title={action.label} mouseEnterDelay={0.5}>
                                        <div style={{ ...labelStyle, maxWidth: '60%' }}>{action.label}</div>
                                    </Tooltip>

                                    <div style={shortcutZoneStyle}>
                                        <div
                                            style={{ cursor: 'pointer', display: 'flex', gap: '2px' }}
                                            onClick={() => setEditingActionId(action.id)}
                                        >
                                            {effectiveBindings.length === 0 ? (
                                                <Tag style={tagStyle(isEditing)}>None</Tag>
                                            ) : (
                                                effectiveBindings.map((binding) => (
                                                    <Tag key={binding} style={tagStyle(isEditing)}>
                                                        {formatKeyCombo(binding)}
                                                    </Tag>
                                                ))
                                            )}
                                        </div>

                                        <div className="item-actions" style={{ ...iconGroupStyle, gap: '2px' }}>
                                            <Tooltip title="清空">
                                                <Button
                                                    type="text"
                                                    size="small"
                                                    danger
                                                    icon={<DeleteOutlined />}
                                                    style={miniButtonStyle}
                                                    onClick={(e) => { e.stopPropagation(); setBindings(action.id, []); }}
                                                />
                                            </Tooltip>
                                            <Tooltip title="设为默认">
                                                <Button
                                                    type="text"
                                                    size="small"
                                                    icon={<UndoOutlined />}
                                                    style={{ ...miniButtonStyle, color: '#555' }}
                                                    onClick={(e) => { e.stopPropagation(); clearBindings(action.id); }}
                                                />
                                            </Tooltip>
                                        </div>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </div>
            ))}
        </div>
    )
}
