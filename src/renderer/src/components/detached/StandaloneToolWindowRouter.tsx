import React from 'react'
import { Alert } from 'antd'
import { getCurrentWindow } from '@tauri-apps/api/window'
import CameraManagerModal from '../modals/CameraManagerModal'
import GeosetEditorModal from '../modals/GeosetEditorModal'
import GeosetAnimationModal from '../modals/GeosetAnimationModal'
import TextureAnimationManagerModal from '../modals/TextureAnimationManagerModal'
import MaterialEditorModal from '../modals/MaterialEditorModal'
import SequenceEditorModal from '../modals/SequenceEditorModal'
import GlobalSequenceModal from '../modals/GlobalSequenceModal'
import GeosetVisibilityToolModal from '../modals/GeosetVisibilityToolModal'
import TextureEditorModal from '../modals/TextureEditorModal'
import ModelOptimizeModal from '../modals/ModelOptimizeModal'
import KeyframeEditor from '../editors/KeyframeEditor'

export const isStandaloneToolWindowLabel = (windowLabel: string | null | undefined): boolean => {
    if (!windowLabel) return false
    return windowLabel === 'cameraManager'
        || windowLabel === 'geosetEditor'
        || windowLabel === 'geosetAnimManager'
        || windowLabel === 'textureManager'
        || windowLabel === 'textureAnimManager'
        || windowLabel === 'materialManager'
        || windowLabel === 'sequenceManager'
        || windowLabel === 'globalSequenceManager'
        || windowLabel === 'geosetVisibilityTool'
        || windowLabel === 'modelOptimize'
        || windowLabel.startsWith('keyframeEditor_')
}

interface StandaloneToolWindowRouterProps {
    windowLabel: string
}

const StandaloneToolWindowRouter: React.FC<StandaloneToolWindowRouterProps> = ({ windowLabel }) => {
    const handleHide = async () => {
        try {
            await getCurrentWindow().hide()
        } catch (error) {
            console.error('[StandaloneToolWindowRouter] hide failed:', error)
        }
    }

    if (windowLabel === 'cameraManager') {
        return <CameraManagerModal visible={true} onClose={handleHide} isStandalone={true} />
    }

    if (windowLabel === 'geosetEditor') {
        return <GeosetEditorModal visible={true} onClose={handleHide} isStandalone={true} />
    }

    if (windowLabel === 'geosetAnimManager') {
        return <GeosetAnimationModal visible={true} onClose={handleHide} isStandalone={true} />
    }

    if (windowLabel === 'textureManager') {
        return <TextureEditorModal visible={true} onClose={handleHide} isStandalone={true} />
    }

    if (windowLabel === 'textureAnimManager') {
        return <TextureAnimationManagerModal visible={true} onClose={handleHide} isStandalone={true} />
    }

    if (windowLabel === 'materialManager') {
        return <MaterialEditorModal visible={true} onClose={handleHide} isStandalone={true} />
    }

    if (windowLabel === 'sequenceManager') {
        return <SequenceEditorModal visible={true} onClose={handleHide} isStandalone={true} />
    }

    if (windowLabel === 'globalSequenceManager') {
        return <GlobalSequenceModal visible={true} onClose={handleHide} isStandalone={true} />
    }

    if (windowLabel === 'geosetVisibilityTool') {
        return <GeosetVisibilityToolModal visible={true} onClose={handleHide} isStandalone={true} />
    }

    if (windowLabel === 'modelOptimize') {
        return <ModelOptimizeModal visible={true} onClose={handleHide} modelData={null} isStandalone={true} />
    }

    if (windowLabel.startsWith('keyframeEditor_')) {
        return (
            <KeyframeEditor
                visible={true}
                onCancel={handleHide}
                onOk={() => { }}
                initialData={null}
                isStandalone={true}
            />
        )
    }

    return (
        <div style={{ height: '100vh', padding: 16, backgroundColor: '#1f1f1f' }}>
            <Alert type="error" message={`Unsupported standalone window: ${windowLabel}`} showIcon />
        </div>
    )
}

export default StandaloneToolWindowRouter
