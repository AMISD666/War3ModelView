import React from 'react'
import { getNextRenderMode, type RenderMode } from '../../store/rendererStore'
import type { ViewerProps, ViewerRef } from '../Viewer'

const Viewer = React.lazy(() => import('../Viewer'))
const UVModeLayout = React.lazy(() => import('../UVModeLayout'))
const AnimationModeLayout = React.lazy(() => import('../animation/AnimationModeLayout'))
const RetargetModeLayout = React.lazy(() => import('./RetargetModeLayout'))

interface RetargetModeHostProps {
    mainMode: 'view' | 'geometry' | 'uv' | 'animation' | 'retarget'
    modelPath: string | null
    viewerModelData: any
    teamColor: number
    showGridXY: boolean
    showNodes: boolean
    showSkeleton: boolean
    showCollisionShapes: boolean
    showCameras: boolean
    showLights: boolean
    showAttachments: boolean
    renderMode: RenderMode
    setRenderMode: (mode: RenderMode) => void
    backgroundColor: string
    currentSequence: number
    isPlaying: boolean
    handleTogglePlay: () => void
    handleToggleLooping: () => void
    handleModelLoaded: (model: any) => void
    handleModelFirstFrameReady: () => void
    showFPS: boolean
    playbackSpeed: number
    viewPreset: ViewerProps['viewPreset']
    handleSetViewPreset: (preset: string) => void
    handleAddCameraFromView: () => void
    handleSave: () => boolean | Promise<boolean>
    handleExportMDL: () => void | Promise<void>
    handleExportMDX: () => void | Promise<void>
    rightPanelAddon: React.ReactNode
    viewerRef: React.Ref<ViewerRef>
}

export const RetargetModeHost: React.FC<RetargetModeHostProps> = (props) => {
    if (props.mainMode === 'retarget') {
        return (
            <RetargetModeLayout
                onSaveTarget={props.handleSave}
                onExportTargetMDL={props.handleExportMDL}
                onExportTargetMDX={props.handleExportMDX}
            />
        )
    }

    return (
        <AnimationModeLayout isActive={props.mainMode === 'animation'} rightPanelAddon={props.rightPanelAddon}>
            <UVModeLayout modelPath={props.modelPath} isActive={props.mainMode === 'uv'}>
                <Viewer
                    ref={props.viewerRef as any}
                    modelPath={props.modelPath}
                    modelData={props.viewerModelData}
                    teamColor={props.teamColor}
                    showGrid={props.showGridXY}
                    showNodes={props.mainMode !== 'uv' && props.showNodes}
                    showSkeleton={props.mainMode !== 'uv' && props.showSkeleton}
                    showCollisionShapes={props.mainMode !== 'uv' && props.showCollisionShapes}
                    showCameras={props.mainMode !== 'uv' && props.showCameras}
                    showLights={props.mainMode !== 'uv' && props.mainMode !== 'animation' && props.showLights}
                    showAttachments={props.mainMode !== 'uv' && props.showAttachments}
                    showWireframe={props.renderMode === 'wireframe'}
                    showWireframeOverlay={props.renderMode === 'texturedWireframe'}
                    onToggleWireframe={() => props.setRenderMode(getNextRenderMode(props.renderMode))}
                    backgroundColor={props.backgroundColor}
                    animationIndex={props.mainMode === 'uv' ? -1 : props.currentSequence}
                    isPlaying={props.mainMode !== 'uv' && props.isPlaying}
                    onTogglePlay={props.handleTogglePlay}
                    onToggleLooping={props.handleToggleLooping}
                    onModelLoaded={props.handleModelLoaded}
                    onModelFirstFrameReady={props.handleModelFirstFrameReady}
                    showFPS={props.mainMode !== 'uv' && props.showFPS}
                    playbackSpeed={props.playbackSpeed}
                    viewPreset={props.viewPreset}
                    onSetViewPreset={props.handleSetViewPreset}
                    onAddCameraFromView={props.handleAddCameraFromView}
                />
            </UVModeLayout>
        </AnimationModeLayout>
    )
}

export default RetargetModeHost
