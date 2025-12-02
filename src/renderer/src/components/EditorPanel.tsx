import React from 'react'
import TextureEditor from './editors/TextureEditor'
import SequenceEditor from './editors/SequenceEditor'
import MaterialEditor from './editors/MaterialEditor'
import GeosetEditor from './editors/GeosetEditor'

interface EditorPanelProps {
    activeTab: string
    model: any
    modelPath?: string
    onUpdate: () => void
    onClose: () => void
}

import { ConfigProvider, theme } from 'antd'

const EditorPanel: React.FC<EditorPanelProps> = ({ activeTab, model, modelPath, onUpdate, onClose }) => {
    const getTitle = () => {
        switch (activeTab) {
            case 'texture': return '纹理编辑器'
            case 'sequence': return '序列编辑器'
            case 'material': return '材质编辑器'
            case 'geoset': return '多边形编辑器'
            default: return '编辑器'
        }
    }

    return (
        <ConfigProvider theme={{ algorithm: theme.darkAlgorithm }}>
            <div style={{
                width: '100%',
                height: '100%',
                backgroundColor: '#141414', // Ant Design Dark bg
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
                    {activeTab === 'texture' && <TextureEditor model={model} modelPath={modelPath} onUpdate={onUpdate} />}
                    {activeTab === 'sequence' && <SequenceEditor model={model} onUpdate={onUpdate} />}
                    {activeTab === 'material' && <MaterialEditor model={model} onUpdate={onUpdate} />}
                    {activeTab === 'geoset' && <GeosetEditor model={model} onUpdate={onUpdate} />}
                </div>
            </div>
        </ConfigProvider>
    )
}

export default EditorPanel
