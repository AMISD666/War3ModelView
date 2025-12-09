/**
 * MasterDetailLayout - Reusable component for List + Detail pattern
 * Used by all editor modals for consistent UI
 */

import React from 'react'
import { List, Card, Empty, Typography, Button } from 'antd'
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons'

const { Text } = Typography

// Common dark theme styles
export const darkTheme = {
    card: {
        backgroundColor: '#2d2d2d',
        border: '1px solid #444',
        borderRadius: 4,
    },
    cardHead: {
        borderBottom: '1px solid #444',
        color: '#fff',
    },
    label: {
        color: '#e8e8e8',
        marginBottom: 4,
        display: 'block',
    },
    input: {
        backgroundColor: '#252525',
        borderColor: '#4a4a4a',
        color: '#e8e8e8',
    },
    listItem: {
        padding: '8px 12px',
        cursor: 'pointer',
        borderRadius: 4,
        marginBottom: 2,
    },
    listItemSelected: {
        backgroundColor: '#1677ff',
        color: '#fff',
    },
    listItemHover: {
        backgroundColor: '#3a3a3a',
    },
}

interface MasterDetailLayoutProps<T> {
    // List configuration
    items: T[]
    selectedIndex: number
    onSelect: (index: number) => void
    renderListItem: (item: T, index: number, isSelected: boolean) => React.ReactNode
    onContextMenu?: (item: T, index: number, event: React.MouseEvent) => void
    listTitle?: string

    // Add/Delete actions
    onAdd?: () => void
    onDelete?: (index: number) => void
    addLabel?: string

    // Detail panel
    renderDetail: (item: T, index: number) => React.ReactNode
    detailTitle?: string

    // Layout
    listWidth?: number | string
    extraButtons?: React.ReactNode
}

export function MasterDetailLayout<T>({
    items,
    selectedIndex,
    onSelect,
    renderListItem,
    listTitle = '列表',
    onAdd,
    onDelete,
    addLabel: _addLabel = '添加',
    renderDetail,
    detailTitle = '详情',
    listWidth = 200,
    onContextMenu,
    extraButtons,
}: MasterDetailLayoutProps<T>) {
    const selectedItem = selectedIndex >= 0 && selectedIndex < items.length ? items[selectedIndex] : null

    return (
        <div style={{ display: 'flex', gap: 16, height: '100%', minHeight: 400 }}>
            {/* Left: List Panel */}
            <Card
                size="small"
                title={<span style={{ color: '#fff' }}>{listTitle}</span>}
                style={{ ...darkTheme.card, width: listWidth, flexShrink: 0, display: 'flex', flexDirection: 'column' }}
                styles={{ header: darkTheme.cardHead, body: { flex: 1, overflow: 'auto', padding: 8 } }}
                onContextMenu={(e) => e.preventDefault()}
                extra={
                    <div style={{ display: 'flex', gap: 4 }}>
                        {extraButtons}
                        {onAdd && (
                            <Button
                                type="text"
                                size="small"
                                icon={<PlusOutlined />}
                                onClick={onAdd}
                                style={{ color: '#1677ff' }}
                            />
                        )}
                        {onDelete && selectedIndex >= 0 && (
                            <Button
                                type="text"
                                size="small"
                                danger
                                icon={<DeleteOutlined />}
                                onClick={() => onDelete(selectedIndex)}
                            />
                        )}
                    </div>
                }
            >
                {items.length === 0 ? (
                    <Empty description={<Text style={{ color: '#666' }}>暂无数据</Text>} image={Empty.PRESENTED_IMAGE_SIMPLE} />
                ) : (
                    <List
                        dataSource={items}
                        split={false}
                        renderItem={(item, index) => {
                            const isSelected = index === selectedIndex
                            return (
                                <div
                                    key={index}
                                    onClick={() => onSelect(index)}
                                    style={{
                                        ...darkTheme.listItem,
                                        ...(isSelected ? darkTheme.listItemSelected : {}),
                                        transition: 'background-color 0.2s',
                                    }}
                                    onContextMenu={(e) => {
                                        if (onContextMenu) {
                                            // e.preventDefault() is already handled by parent, or we can do it here too to be safe/specific
                                            // Actually parent just disables browser menu. We want to trigger custom menu.
                                            // The user might want to prevent browser menu on the whole list, but allow custom on items.
                                            // The parent onContextMenu={e => e.preventDefault()} handles the browser one.
                                            // We just fire the callback.
                                            onContextMenu(item, index, e)
                                        }
                                    }}
                                    onMouseEnter={(e) => {
                                        if (!isSelected) {
                                            e.currentTarget.style.backgroundColor = '#3a3a3a'
                                        }
                                    }}
                                    onMouseLeave={(e) => {
                                        if (!isSelected) {
                                            e.currentTarget.style.backgroundColor = 'transparent'
                                        }
                                    }}
                                >
                                    {renderListItem(item, index, isSelected)}
                                </div>
                            )
                        }}
                    />
                )}
            </Card>

            {/* Right: Detail Panel */}
            <Card
                size="small"
                title={<span style={{ color: '#fff' }}>{detailTitle}</span>}
                style={{ ...darkTheme.card, flex: 1, display: 'flex', flexDirection: 'column' }}
                styles={{ header: darkTheme.cardHead, body: { flex: 1, overflow: 'auto', padding: 16 } }}
            >
                {selectedItem ? (
                    renderDetail(selectedItem, selectedIndex)
                ) : (
                    <Empty description={<Text style={{ color: '#666' }}>请从左侧选择一项</Text>} />
                )}
            </Card>
        </div>
    )
}

// Helper component for consistent form field styling
interface LabeledFieldProps {
    label: string
    children: React.ReactNode
    style?: React.CSSProperties
}

export const LabeledField: React.FC<LabeledFieldProps> = ({ label, children, style }) => (
    <div style={{ marginBottom: 12, ...style }}>
        <div style={darkTheme.label}>{label}</div>
        {children}
    </div>
)

// Helper for inline label + input
interface InlineFieldProps {
    label: string
    labelWidth?: number
    children: React.ReactNode
}

export const InlineField: React.FC<InlineFieldProps> = ({ label, labelWidth = 80, children }) => (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ ...darkTheme.label, width: labelWidth, marginBottom: 0, marginRight: 8, textAlign: 'right' }}>{label}</span>
        <div style={{ flex: 1 }}>{children}</div>
    </div>
)

export default MasterDetailLayout
