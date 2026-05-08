import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ConfigProvider, theme, type ThemeConfig } from 'antd'
import { windowGateway } from '../../infrastructure/window'
import { useRpcClient } from '../../hooks/useRpc'
import { getNodeEditorWindowTitle } from '../../application/window-bridge/ToolWindowLayouts'
import {
    NODE_EDITOR_COMMANDS,
    type NodeEditorKind,
    type NodeEditorCommandSender,
    type NodeEditorMaterialSummary,
    type NodeEditorNodeSummary,
    type NodeEditorPivotPoint,
    type NodeEditorRpcState,
    type NodeEditorSequenceSummary,
    type NodeEditorTextureDetail,
    type NodeEditorTextureSummary,
} from '../../types/nodeEditorRpc'
import { createRevisionedNodeEditorCommandPayload } from '../../application/commands/NodeEditorCommandPayload'
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
    documentId: null,
    documentRevision: 0,
    assetRevision: 0,
    previewRevision: 0,
    snapshotRevision: 0,
    windowId: 'nodeEditor',
    snapshotVersion: 0,
    sessionNonce: 0,
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
    selectedPivotPoint: null,
    selectedParticleEmitter2Texture: null,
}

/**
 * 独立 WebView 节点编辑器，根据 RPC 快照中的 kind 渲染对应的编辑界面。
 * 外层沿用 StandaloneWindowFrame，和其他独立管理器窗口保持一致。
 */
const NodeEditorStandalone: React.FC = () => {
    const { state, emitCommand } = useRpcClient<NodeEditorRpcState>('nodeEditor', initialRpcState)
    const snapshotRevision = state.snapshotRevision || state.snapshotVersion
    const emitRevisionedCommand: NodeEditorCommandSender = (command, payload) => {
        emitCommand(command, createRevisionedNodeEditorCommandPayload(command, payload, {
            documentId: state.documentId,
            documentRevision: state.documentRevision,
        }))
    }
    const sessionKeyRef = useRef('')
    const [frozenNode, setFrozenNode] = useState<any>(null)
    const [frozenSessionKey, setFrozenSessionKey] = useState('')
    const [closedSessionKey, setClosedSessionKey] = useState('')
    const [editorSessionRev, setEditorSessionRev] = useState(0)
    const textureDetailRefreshTimersRef = useRef<number[]>([])
    const stateRef = useRef<NodeEditorRpcState>(initialRpcState)
    const activeSessionKey =
        state.kind && state.objectId >= 0
            ? `${state.kind}:${state.objectId}:${state.sessionNonce}`
            : ''
    const hydrateSelectedPivotPoint = (node: any, pivotPoint?: NodeEditorPivotPoint | null) => {
        if (!node || !pivotPoint) {
            return node
        }
        return {
            ...node,
            PivotPoint: pivotPoint,
        }
    }

    useEffect(() => {
        stateRef.current = state
    }, [state])

    useEffect(() => {
        const key = activeSessionKey
        if (sessionKeyRef.current !== key) {
            sessionKeyRef.current = key
            setFrozenNode(null)
            setFrozenSessionKey('')
            setClosedSessionKey('')
        }
    }, [activeSessionKey])

    useEffect(() => {
        if (state.kind === 'rename') return
        if (!activeSessionKey) return
        if (closedSessionKey === activeSessionKey) return
        if (frozenNode !== null && frozenSessionKey === activeSessionKey) return
        if (state.node && state.objectId >= 0 && state.kind) {
            try {
                setFrozenNode(hydrateSelectedPivotPoint(structuredClone(state.node), state.selectedPivotPoint))
            } catch {
                setFrozenNode(hydrateSelectedPivotPoint(JSON.parse(JSON.stringify(state.node)), state.selectedPivotPoint))
            }
            setFrozenSessionKey(activeSessionKey)
        }
    }, [activeSessionKey, closedSessionKey, state.node, state.selectedPivotPoint, state.objectId, state.kind, frozenNode, frozenSessionKey])

    const handleClose = async () => {
        setClosedSessionKey(activeSessionKey)
        sessionKeyRef.current = activeSessionKey
        setFrozenNode(null)
        setFrozenSessionKey('')
        setEditorSessionRev((v) => v + 1)
        try {
            await windowGateway.hideCurrentWindow()
        } catch (e) {
            console.error('[NodeEditorStandalone] hide failed:', e)
        }
    }

    const requestNodeEditorSnapshot = () => {
        windowGateway.emit('rpc-req-nodeEditor').catch(() => {})
    }

    const requestSelectedTextureDetailRefresh = (textureId: number) => {
        if (!Number.isInteger(textureId) || textureId < -1) {
            return
        }
        textureDetailRefreshTimersRef.current.forEach((timerId) => window.clearTimeout(timerId))
        textureDetailRefreshTimersRef.current = [
            window.setTimeout(requestNodeEditorSnapshot, 40),
            window.setTimeout(requestNodeEditorSnapshot, 220),
        ]
    }

    const resolveSelectedTextureDetail = async (textureId: number): Promise<NodeEditorTextureDetail | null> => {
        if (!Number.isInteger(textureId) || textureId < 0) {
            return null
        }
        const currentTexture = stateRef.current.selectedParticleEmitter2Texture
        if (currentTexture?.index === textureId) {
            return currentTexture
        }
        requestSelectedTextureDetailRefresh(textureId)
        return new Promise((resolve) => {
            const startedAt = Date.now()
            let pollTimerId = 0
            const timeoutMs = 320
            const finish = (texture: NodeEditorTextureDetail | null) => {
                if (pollTimerId) {
                    window.clearTimeout(pollTimerId)
                }
                resolve(texture)
            }
            const poll = () => {
                const texture = stateRef.current.selectedParticleEmitter2Texture
                if (texture?.index === textureId) {
                    finish(texture)
                    return
                }
                if (Date.now() - startedAt >= timeoutMs) {
                    finish(null)
                    return
                }
                pollTimerId = window.setTimeout(poll, 24)
            }
            pollTimerId = window.setTimeout(poll, 24)
        })
    }

    useEffect(() => {
        return () => {
            textureDetailRefreshTimersRef.current.forEach((timerId) => window.clearTimeout(timerId))
            textureDetailRefreshTimersRef.current = []
        }
    }, [])

    const normalizedAllNodes = useMemo(() => {
        const summaries = state.nodeSummaries ?? state.resources?.nodes ?? []
        const summaryNodes = summaries.map((node: NodeEditorNodeSummary) => ({
            ObjectId: node.objectId,
            Name: node.name,
            Parent: node.parent,
        }))
        return summaryNodes.length > 0 ? summaryNodes : state.allNodes
    }, [state.allNodes, state.nodeSummaries, state.resources?.nodes])

    const normalizedTextures = useMemo(() => {
        if (Array.isArray(state.textures) && state.textures.length > 0) {
            return state.textures
        }
        const summaries = state.textureSummaries ?? state.resources?.textures ?? []
        return summaries.map((texture: NodeEditorTextureSummary) => ({
            Image: texture.image ?? '',
            Path: texture.image ?? '',
            ReplaceableId: texture.replaceableId ?? 0,
        }))
    }, [state.textures, state.textureSummaries, state.resources?.textures])

    const normalizedMaterials = useMemo(() => {
        if (Array.isArray(state.materials) && state.materials.length > 0) {
            return state.materials
        }
        const summaries = state.materialSummaries ?? state.resources?.materials ?? []
        return summaries.map((material: NodeEditorMaterialSummary) => ({
            PriorityPlane: material.priorityPlane ?? 0,
            Layers: Array.from({ length: Math.max(0, material.layerCount ?? 0) }, () => ({})),
        }))
    }, [state.materials, state.materialSummaries, state.resources?.materials])

    const normalizedSequences = useMemo(() => {
        const summaries = state.sequenceSummaries ?? state.resources?.sequences ?? []
        const summarySequences = summaries.map((sequence: NodeEditorSequenceSummary) => ({
            Name: sequence.name,
            Interval: sequence.interval ?? [0, 0],
        }))
        return summarySequences.length > 0 ? summarySequences : state.sequences
    }, [state.sequenceSummaries, state.resources?.sequences, state.sequences])

    const normalizedGlobalSequences = useMemo(
        () => state.globalSequenceDurations ?? state.resources?.globalSequenceDurations ?? state.globalSequences ?? [],
        [state.globalSequenceDurations, state.resources?.globalSequenceDurations, state.globalSequences]
    )

    const standaloneModelData = useMemo(
        () => ({
            Textures: normalizedTextures,
            textureSummaries: state.textureSummaries ?? state.resources?.textures ?? [],
            Materials: normalizedMaterials,
            GlobalSequences: normalizedGlobalSequences,
            Sequences: normalizedSequences,
            selectedParticleEmitter2Texture: state.selectedParticleEmitter2Texture ?? null,
        }),
        [
            snapshotRevision,
            normalizedTextures,
            state.textureSummaries,
            state.resources?.textures,
            normalizedMaterials,
            normalizedGlobalSequences,
            normalizedSequences,
            state.selectedParticleEmitter2Texture,
        ]
    )

    const frameTitle =
        state.kind && state.objectId >= 0
            ? getNodeEditorWindowTitle(state.kind as NodeEditorKind)
            : '节点编辑器'

    const editorKey = `${state.kind}:${state.objectId}:${state.sessionNonce}:${editorSessionRev}`
    const isClosedSession = activeSessionKey !== '' && closedSessionKey === activeSessionKey
    const isFrozenNodeReady =
        !isClosedSession && (state.kind === 'rename' || (frozenNode !== null && frozenSessionKey === activeSessionKey))

    useEffect(() => {
        if (!activeSessionKey || isFrozenNodeReady) return

        const firstTimer = window.setTimeout(requestNodeEditorSnapshot, 160)
        const secondTimer = window.setTimeout(requestNodeEditorSnapshot, 650)

        return () => {
            window.clearTimeout(firstTimer)
            window.clearTimeout(secondTimer)
        }
    }, [activeSessionKey, isFrozenNodeReady])

    if (!state.kind || state.objectId < 0) {
        return (
            <ConfigProvider theme={nodeEditorStandaloneTheme}>
                <StandaloneWindowFrame title="节点编辑器" onClose={handleClose}>
                    <div style={{ padding: 16, color: '#b0b0b0' }}>正在同步模型数据...</div>
                </StandaloneWindowFrame>
            </ConfigProvider>
        )
    }

    if (!isFrozenNodeReady) {
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
                            standaloneEmit={emitRevisionedCommand}
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
                            standaloneEmit={emitRevisionedCommand}
                            standaloneModelData={standaloneModelData}
                            standaloneModelPath={state.modelPath}
                            onStandaloneTextureDetailRefreshRequest={requestSelectedTextureDetailRefresh}
                            resolveStandaloneTextureDetail={resolveSelectedTextureDetail}
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
                            standaloneEmit={emitRevisionedCommand}
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
                            standaloneEmit={emitRevisionedCommand}
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
                            standaloneEmit={emitRevisionedCommand}
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
                            standaloneEmit={emitRevisionedCommand}
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
                            standaloneEmit={emitRevisionedCommand}
                            standaloneModelData={standaloneModelData}
                            standaloneAllNodes={normalizedAllNodes}
                        />
                    )}
                    {state.kind === 'rename' && (
                        <RenameNodeDialog
                            key={editorKey}
                            visible={true}
                            nodeId={state.objectId}
                            currentName={state.renameInitialName}
                            onRename={(newName) => {
                                emitRevisionedCommand(NODE_EDITOR_COMMANDS.renameNode, {
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
