/**
 * TabBar Component - Displays open model tabs at the top of the viewer
 */

import React from 'react';
import { useModelStore } from '../store/modelStore';
import { CloseOutlined } from '@ant-design/icons';
import { showDiscardConfirm } from '../store/messageStore';

interface TabBarProps {
    emptyText?: string;
}

export const TabBar: React.FC<TabBarProps> = ({ emptyText }) => {
    const { tabs, activeTabId, setActiveTab, closeTab, isTabDirty } = useModelStore();

    const handleCloseTab = async (tabId: string, name: string) => {
        if (isTabDirty(tabId)) {
            const shouldClose = await showDiscardConfirm('未保存的修改', `关闭“${name}”前，是否不保存并直接关闭？`);
            if (!shouldClose) return;
        }
        closeTab(tabId);
    };

    // We always render the container now to keep it persistent as requested by the user.
    // if (tabs.length === 0) {
    //     return null; // No tabs, don't render anything
    // }

    return (
        <div style={{
            display: 'flex',
            alignItems: 'center',
            backgroundColor: '#1e1e1e',
            borderBottom: '1px solid #333',
            height: 32,
            overflow: 'hidden',
            flexShrink: 0
        }}>
            {tabs.length === 0 && emptyText && (
                <div style={{
                    padding: '0 12px',
                    color: '#888',
                    fontSize: 12,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                }}>
                    {emptyText}
                </div>
            )}
            {tabs.map((tab) => {
                const isActive = tab.id === activeTabId;
                return (
                    <div
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            padding: '0 12px',
                            height: '100%',
                            backgroundColor: isActive ? '#2d2d2d' : 'transparent',
                            borderRight: '1px solid #333',
                            cursor: 'pointer',
                            color: isActive ? '#fff' : '#888',
                            fontSize: 12,
                            maxWidth: 200,
                            transition: 'background-color 0.15s'
                        }}
                        onMouseEnter={(e) => {
                            if (!isActive) {
                                e.currentTarget.style.backgroundColor = '#252525';
                            }
                        }}
                        onMouseLeave={(e) => {
                            if (!isActive) {
                                e.currentTarget.style.backgroundColor = 'transparent';
                            }
                        }}
                    >
                        <span style={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            flex: 1,
                            marginRight: 8
                        }}>
                            {tab.name}
                        </span>
                        <CloseOutlined
                            onClick={(e) => {
                                e.stopPropagation();
                                void handleCloseTab(tab.id, tab.name);
                            }}
                            style={{
                                fontSize: 10,
                                color: '#666',
                                padding: 2,
                                borderRadius: 2
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.backgroundColor = '#444';
                                e.currentTarget.style.color = '#fff';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.backgroundColor = 'transparent';
                                e.currentTarget.style.color = '#666';
                            }}
                        />
                    </div>
                );
            })}
        </div>
    );
};

export default TabBar;
