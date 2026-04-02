import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ConfigProvider, theme, type ThemeConfig } from 'antd'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useRpcClient } from '../../hooks/useRpc'
import {
    NODE_EDITOR_COMMANDS,
    getNodeEditorWindowLayout,
    type NodeEditorKind,
    type NodeEditorRpcState,
} from '../../types/nodeEditorRpc'
import { StandaloneWindowFrame } from '../common/StandaloneWindowFrame'
import ParticleEmitterDialog from '../node/ParticleEmitterDialog'
import ParticleEmitter2Dialog from '../node/ParticleEmitter2Dialog'
import CollisionShapeDialog from '../node/CollisionShapeDialog'
import LightDialog from '../node/LightDialog'
import EventObjectDialog from '../node/EventObjectDialog'
import RibbonEmitterDialog from '../node/RibbonEmitterDialog'
import NodeDialog from '../node/NodeDialog'
import { RenameNodeDialog } from '../node/RenameNodeDialog'

/** 独立节点编辑器的深色主题，避免脱离主应用 ConfigProvider 后样式回退。 */
const nodeEditorStandaloneTheme: ThemeConfig = {
    algorithm: theme.darkAlgorithm,
    token: {
        colorText: '#e8e8e8',
        colorTextSecondary: '#b0b0b0',
        colorTextTertiary: '#888888',
        colorTextQuaternary: '#707070',
        colorBgContainer: '#1f1f1f',
        colorBgElevated: '#2c2c2c',
        colorBorder: '#4a4a4a',
        colorBorderSecondary: '#3a3a3a',
    },
}

const initialRpcState: NodeEditorRpcState = {
    snapshotVersion: 0,
    kind: '',
    objectId: -1,
    node: null,
    textures: [],
    materials: [],
    globalSequences: [],
    sequences: [],
    modelPath: '',
    renameInitialName: '',
    allNodes: [],
    pivotPoints: [],
}

/**
 * 独立 WebView 节点编辑器，根据 RPC 快照中的 kind 渲染对应的编辑界面。
 * 外层沿用 StandaloneWindowFrame，和其他独立管理器窗口保持一致。
 */
const NodeEditorStandalone: React.FC = () => {
    const { state, emitCommand } = useRpcClient<NodeEditorRpcState>('nodeEditor', initialRpcState)
    const sessionKeyRef = useRef('')
    const [frozenNode, setFrozenNode] = useState<any>(null)
    const [editorSessionRev, setEditorSessionRev] = useState(0)

    useEffect(() => {
        const key = `${state.kind}:${state.objectId}`
        if (sessionKeyRef.current !== key) {
            sessionKeyRef.current = key
            setFrozenNode(null)
        }
    }, [state.kind, state.objectId])

    useEffect(() => {
        if (state.kind === 'rename') return
        if (frozenNode !== null) return
        if (state.node && state.objectId >= 0 && state.kind) {
            try {
                setFrozenNode(structuredClone(state.node))
            } catch {
                setFrozenNode(JSON.parse(JSON.stringify(state.node)))
            }
        }
    }, [state.node, state.objectId, state.kind, frozenNode])

    const handleClose = async () => {
        sessionKeyRef.current = ''
        setFrozenNode(null)
        setEditorSessionRev((v) => v + 1)
        try {
            await getCurrentWindow().hide()
        } catch (e) {
            console.error('[NodeEditorStandalone] hide failed:', e)
        }
    }

    const standaloneModelData = useMemo(
        () => ({
            Textures: state.textures,
            Materials: state.materials,
            GlobalSequences: state.globalSequences,
            Sequences: state.sequences,
            PivotPoints: state.pivotPoints ?? [],
        }),
        [
            state.snapshotVersion,
            state.textures,
            state.materials,
            state.globalSequences,
            state.sequences,
            state.pivotPoints,
        ]
    )

    const frameTitle =
        state.kind && state.objectId >= 0
            ? getNodeEditorWindowLayout(state.kind as NodeEditorKind).title
            : '节点编辑器'

    const editorKey = `${state.kind}:${state.objectId}:${editorSessionRev}`

    if (!state.kind || state.objectId < 0) {
        return (
            <ConfigProvider theme={nodeEditorStandaloneTheme}>
                <StandaloneWindowFrame title="节点编辑器" onClose={handleClose}>
                    <div style={{ padding: 16, color: '#b0b0b0' }}>正在同步模型数据...</div>
                </StandaloneWindowFrame>
            </ConfigProvider>
        )
    }

    if (state.kind !== 'rename' && frozenNode === null) {
        return (
            <ConfigProvider theme={nodeEditorStandaloneTheme}>
                <StandaloneWindowFrame title={frameTitle} onClose={handleClose}>
                    <div style={{ padding: 16, color: '#b0b0b0' }}>正在加载节点...</div>
                </StandaloneWindowFrame>
            </ConfigProvider>
        )
    }

    return (
        <ConfigProvider theme={nodeEditorStandaloneTheme}>
            <StandaloneWindowFrame title={frameTitle} onClose={handleClose}>
                <div
                    style={{
                        flex: 1,
                        minHeight: 0,
                        overflow: 'hidden',
                        display: 'flex',
                        flexDirection: 'column',
                        backgroundColor: '#1e1e1e',
                    }}
                >
                    {state.kind === 'particleEmitter' && (
                        <ParticleEmitterDialog
                            key={editorKey}
                            visible={true}
                            nodeId={state.objectId}
                            onClose={handleClose}
                            isStandalone={true}
                            standaloneNode={frozenNode}
                            standaloneEmit={emitCommand}
                            standaloneModelData={standaloneModelData}
                        />
                    )}
                    {state.kind === 'particleEmitter2' && (
                        <ParticleEmitter2Dialog
                            key={editorKey}
                            visible={true}
                            nodeId={state.objectId}
                            onClose={handleClose}
                            isStandalone={true}
                            standaloneNode={frozenNode}
                            standaloneEmit={emitCommand}
                            standaloneModelData={standaloneModelData}
                            standaloneModelPath={state.modelPath}
                        />
                    )}
                    {state.kind === 'collisionShape' && (
                        <CollisionShapeDialog
                            key={editorKey}
                            visible={true}
                            nodeId={state.objectId}
                            onClose={handleClose}
                            isStandalone={true}
                            standaloneNode={frozenNode}
                            standaloneEmit={emitCommand}
                        />
                    )}
                    {state.kind === 'light' && (
                        <LightDialog
                            key={editorKey}
                            visible={true}
                            nodeId={state.objectId}
                            onClose={handleClose}
                            isStandalone={true}
                            standaloneNode={frozenNode}
                            standaloneEmit={emitCommand}
                            standaloneModelData={standaloneModelData}
                        />
                    )}
                    {state.kind === 'eventObject' && (
                        <EventObjectDialog
                            key={editorKey}
                            visible={true}
                            nodeId={state.objectId}
                            onClose={handleClose}
                            isStandalone={true}
                            standaloneNode={frozenNode}
                            standaloneEmit={emitCommand}
                            standaloneModelData={standaloneModelData}
                        />
                    )}
                    {state.kind === 'ribbonEmitter' && (
                        <RibbonEmitterDialog
                            key={editorKey}
                            visible={true}
                            nodeId={state.objectId}
                            onClose={handleClose}
                            isStandalone={true}
                            standaloneNode={frozenNode}
                            standaloneEmit={emitCommand}
                            standaloneModelData={standaloneModelData}
                        />
                    )}
                    {state.kind === 'genericNode' && (
                        <NodeDialog
                            key={editorKey}
                            visible={true}
                            nodeId={state.objectId}
                            onClose={handleClose}
                            isStandalone={true}
                            standaloneNode={frozenNode}
                            standaloneEmit={emitCommand}
                            standaloneModelData={standaloneModelData}
                            standaloneAllNodes={state.allNodes}
                        />
                    )}
                    {state.kind === 'rename' && (
                        <RenameNodeDialog
                            key={editorKey}
                            visible={true}
                            nodeId={state.objectId}
                            currentName={state.renameInitialName}
                            onRename={(newName) => {
                                emitCommand(NODE_EDITOR_COMMANDS.renameNode, {
                                    objectId: state.objectId,
                                    name: newName,
                                })
                                void handleClose()
                            }}
                            onCancel={handleClose}
                            isStandalone={true}
                        />
                    )}
                </div>
            </StandaloneWindowFrame>
        </ConfigProvider>
    )
}

export default NodeEditorStandalone
