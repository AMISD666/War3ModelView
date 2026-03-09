import React, { Suspense, lazy } from 'react'

const TextureEditor = lazy(() => import('./editors/TextureEditor'))
const SequenceEditor = lazy(() => import('./editors/SequenceEditor'))
const MaterialEditor = lazy(() => import('./editors/MaterialEditor'))
const GeosetEditor = lazy(() => import('./editors/GeosetEditor'))
const GeosetAnimationEditor = lazy(() => import('./editors/GeosetAnimationEditor'))

interface EditorPanelProps {
    activeTab: string
    onClose: () => void
}

import { ConfigProvider, theme } from 'antd'

const EditorPanel: React.FC<EditorPanelProps> = ({ activeTab, onClose }) => {
    const getTitle = () => {
        switch (activeTab) {
            case 'texture': return '\u7eb9\u7406\u7f16\u8f91\u5668'
            case 'sequence': return '\u6a21\u578b\u52a8\u4f5c\u7ba1\u7406\u5668'
            case 'material': return '\u6750\u8d28\u7ba1\u7406\u5668'
            case 'geoset': return '\u591a\u8fb9\u5f62\u7ba1\u7406\u5668'
            case 'geosetAnim': return '\u591a\u8fb9\u5f62\u52a8\u753b\u7ba1\u7406\u5668'
            default: return '\u7f16\u8f91\u5668'
        }
    }

    return (
        <ConfigProvider theme={{ algorithm: theme.darkAlgorithm }}>
            <div style={{
                width: '100%',
                height: '100%',
                backgroundColor: '#141414',
                borderLeft: '1px solid #303030',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden'
            }}>
                <div style={{
                    padding: '10px',
                    borderBottom: '1px solid #303030',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    backgroundColor: '#1f1f1f'
                }}>
                    <span style={{ fontWeight: 'bold', color: '#fff' }}>{getTitle()}</span>
                    <button onClick={onClose} style={{
                        cursor: 'pointer',
                        padding: '4px 8px',
                        background: 'transparent',
                        border: '1px solid #444',
                        color: '#fff',
                        borderRadius: '4px'
                    }}>X</button>
                </div>
                <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
                    <Suspense fallback={null}>
                        {activeTab === 'texture' && <TextureEditor />}
                        {activeTab === 'sequence' && <SequenceEditor />}
                        {activeTab === 'material' && <MaterialEditor />}
                        {activeTab === 'geoset' && <GeosetEditor />}
                        {activeTab === 'geosetAnim' && <GeosetAnimationEditor />}
                    </Suspense>
                </div>
            </div>
        </ConfigProvider>
    )
}

export default EditorPanel
