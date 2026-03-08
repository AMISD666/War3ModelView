import React, { useMemo, useCallback, useRef, useEffect, useState } from 'react'
import { Typography, Select, message, Button, ColorPicker, Input, Tooltip } from 'antd'
import { quat, vec3 } from 'gl-matrix'
import { useSelectionStore } from '../../store/selectionStore'
import { useModelStore } from '../../store/modelStore'
import { useRendererStore } from '../../store/rendererStore'
import { useHistoryStore } from '../../store/historyStore'
import { SetNodeParentCommand } from '../../commands/SetNodeParentCommand'
import { useCommandManager } from '../../utils/CommandManager'


const { Text } = Typography

// --- 转换工具函数 ---

/**
 * 四元数转欧拉角（弧度 -> 度）
 */
function quatToEuler(q: number[] | Float32Array): [number, number, number] {
    const [x, y, z, w] = q
    const sinr_cosp = 2 * (w * x + y * z)
    const cosr_cosp = 1 - 2 * (x * x + y * y)
    const roll = Math.atan2(sinr_cosp, cosr_cosp)

    const sinp = 2 * (w * y - z * x)
    let pitch: number
    if (Math.abs(sinp) >= 1) pitch = Math.sign(sinp) * Math.PI / 2
    else pitch = Math.asin(sinp)

    const siny_cosp = 2 * (w * z + x * y)
    const cosy_cosp = 1 - 2 * (y * y + z * z)
    const yaw = Math.atan2(siny_cosp, cosy_cosp)

    return [roll * 180 / Math.PI, pitch * 180 / Math.PI, yaw * 180 / Math.PI]
}

/**
 * 欧拉角转四元数（度 -> 弧度 -> 四元数）
 */
function eulerToQuat(euler: [number, number, number]): [number, number, number, number] {
    const [rx, ry, rz] = euler.map(v => v * Math.PI / 180)
    const c1 = Math.cos(rx / 2), s1 = Math.sin(rx / 2)
    const c2 = Math.cos(ry / 2), s2 = Math.sin(ry / 2)
    const c3 = Math.cos(rz / 2), s3 = Math.sin(rz / 2)

    return [
        s1 * c2 * c3 + c1 * s2 * s3, // x
        c1 * s2 * c3 - s1 * c2 * s3, // y
        c1 * c2 * s3 + s1 * s2 * c3, // z
        c1 * c2 * c3 - s1 * s2 * s3  // w
    ]
}

/**
 * Convert World Space delta to Local Space delta
 * Uses the inverse of the parent's rotation matrix to transform the delta
 */
function worldDeltaToLocalDelta(renderer: any, nodeId: number, worldDelta: [number, number, number]): [number, number, number] {
    if (!renderer || !renderer.rendererData || !renderer.rendererData.nodes) {
        return worldDelta
    }

    const nodes = renderer.rendererData.nodes
    const nodeWrapper = nodes.find((n: any) => n.node && n.node.ObjectId === nodeId)

    if (!nodeWrapper || !nodeWrapper.node) return worldDelta

    const parentId = nodeWrapper.node.Parent
    if (parentId === undefined || parentId === -1) {
        return worldDelta
    }

    const parentWrapper = nodes.find((n: any) => n.node && n.node.ObjectId === parentId)
    if (!parentWrapper || !parentWrapper.matrix) {
        return worldDelta
    }

    const parentMat = parentWrapper.matrix
    const invRotation = [
        parentMat[0], parentMat[4], parentMat[8], 0,
        parentMat[1], parentMat[5], parentMat[9], 0,
        parentMat[2], parentMat[6], parentMat[10], 0,
        0, 0, 0, 1
    ]

    const localDelta = vec3.create()
    vec3.transformMat4(localDelta, vec3.fromValues(worldDelta[0], worldDelta[1], worldDelta[2]), invRotation as any)

    return [localDelta[0], localDelta[1], localDelta[2]]
}

// --- 插值函数 ---

const toArray = (v: any, size: number): number[] => {
    if (!v) return size === 4 ? [0, 0, 0, 1] : (size === 3 ? [0, 0, 0] : [])
    if (Array.isArray(v)) return [...v]
    if (v.length !== undefined) return Array.from(v) as number[]
    return size === 4 ? [0, 0, 0, 1] : (size === 3 ? [0, 0, 0] : [])
}

const interpolateTranslation = (keys: any[], frame: number): number[] => {
    if (!keys || keys.length === 0) return [0, 0, 0]
    const sortedKeys = [...keys].sort((a: any, b: any) => a.Frame - b.Frame)

    if (frame <= sortedKeys[0].Frame) return toArray(sortedKeys[0].Vector, 3)
    if (frame >= sortedKeys[sortedKeys.length - 1].Frame) return toArray(sortedKeys[sortedKeys.length - 1].Vector, 3)

    for (let i = 0; i < sortedKeys.length - 1; i++) {
        if (frame >= sortedKeys[i].Frame && frame <= sortedKeys[i + 1].Frame) {
            const t = (frame - sortedKeys[i].Frame) / (sortedKeys[i + 1].Frame - sortedKeys[i].Frame)
            const from = toArray(sortedKeys[i].Vector, 3)
            const to = toArray(sortedKeys[i + 1].Vector, 3)
            return from.map((v, idx) => v + (to[idx] - v) * t)
        }
    }
    return [0, 0, 0]
}

const interpolateRotation = (keys: any[], frame: number): number[] => {
    if (!keys || keys.length === 0) return [0, 0, 0, 1]
    const sortedKeys = [...keys].sort((a: any, b: any) => a.Frame - b.Frame)

    if (frame <= sortedKeys[0].Frame) return toArray(sortedKeys[0].Vector, 4)
    if (frame >= sortedKeys[sortedKeys.length - 1].Frame) return toArray(sortedKeys[sortedKeys.length - 1].Vector, 4)

    for (let i = 0; i < sortedKeys.length - 1; i++) {
        if (frame >= sortedKeys[i].Frame && frame <= sortedKeys[i + 1].Frame) {
            const t = (frame - sortedKeys[i].Frame) / (sortedKeys[i + 1].Frame - sortedKeys[i].Frame)
            const from = quat.fromValues(sortedKeys[i].Vector[0], sortedKeys[i].Vector[1], sortedKeys[i].Vector[2], sortedKeys[i].Vector[3])
            const to = quat.fromValues(sortedKeys[i + 1].Vector[0], sortedKeys[i + 1].Vector[1], sortedKeys[i + 1].Vector[2], sortedKeys[i + 1].Vector[3])
            const out = quat.create()
            quat.slerp(out, from, to, t)
            return Array.from(out)
        }
    }
    return [0, 0, 0, 1]
}

const interpolateScaling = (keys: any[], frame: number): number[] => {
    if (!keys || keys.length === 0) return [1, 1, 1]
    const sortedKeys = [...keys].sort((a: any, b: any) => a.Frame - b.Frame)

    if (frame <= sortedKeys[0].Frame) return toArray(sortedKeys[0].Vector, 3)
    if (frame >= sortedKeys[sortedKeys.length - 1].Frame) return toArray(sortedKeys[sortedKeys.length - 1].Vector, 3)

    for (let i = 0; i < sortedKeys.length - 1; i++) {
        if (frame >= sortedKeys[i].Frame && frame <= sortedKeys[i + 1].Frame) {
            const t = (frame - sortedKeys[i].Frame) / (sortedKeys[i + 1].Frame - sortedKeys[i].Frame)
            const from = toArray(sortedKeys[i].Vector, 3)
            const to = toArray(sortedKeys[i + 1].Vector, 3)
            return from.map((v, idx) => v + (to[idx] - v) * t)
        }
    }
    return [1, 1, 1]
}

const isAnimTrack = (value: any): value is { Keys: any[]; LineType?: number; GlobalSeqId?: number | null } => {
    return !!value && typeof value === 'object' && Array.isArray(value.Keys)
}


const deepClone = <T,>(value: T): T => {
    const cloneFn = (globalThis as any).structuredClone
    if (typeof cloneFn === 'function') return cloneFn(value)
    return JSON.parse(JSON.stringify(value))
}

const MAX_DISPLAY_DECIMALS = 4

const roundToDecimals = (value: number, decimals: number): number => {
    if (!Number.isFinite(value)) return 0
    const factor = 10 ** decimals
    const rounded = Math.round((value + Number.EPSILON) * factor) / factor
    return Object.is(rounded, -0) ? 0 : rounded
}

const formatInputNumber = (value: number, decimals = MAX_DISPLAY_DECIMALS): string => {
    const safeDecimals = Math.max(0, Math.min(decimals, MAX_DISPLAY_DECIMALS))
    const rounded = roundToDecimals(Number(value) || 0, safeDecimals)
    if (Number.isInteger(rounded)) return String(rounded)
    return rounded.toFixed(safeDecimals).replace(/\.?0+$/, '')
}

/**
 * 节点参数面板 - 显示选中骨骼的 T/R/S 信息和绑定骨骼列表
 */
const BoneParameterPanel: React.FC = () => {
    const {
        selectedNodeIds,
        selectNodes,
        selectedVertexIds,
        multiMoveMode,
        setMultiMoveMode,
        animationSubMode,
        pickedGeosetIndex,
        timelineKeyframeDisplayMode
    } = useSelectionStore()

    const nodes = useModelStore(state => state.nodes)
    const modelData = useModelStore(state => state.modelData)
    const currentFrame = useModelStore(state => state.currentFrame)
    const renderer = useRendererStore(state => state.renderer)
    const { executeCommand } = useCommandManager()
    const [translationSpace, setTranslationSpace] = useState<'world' | 'local'>('world')
    const [worldTick, setWorldTick] = useState(0)
    const [viewportHeight, setViewportHeight] = useState(() => (typeof window !== 'undefined' ? window.innerHeight : 720))
    const safeNodes = useMemo(
        () => (Array.isArray(nodes) ? nodes.filter((n: any) => n && typeof n.ObjectId === 'number') : []),
        [nodes]
    )

    // 选中的单个骨骼
    const selectedNode = selectedNodeIds.length === 1
        ? safeNodes.find((n: any) => n && n.ObjectId === selectedNodeIds[0])
        : null

    // 计算骨骼绑定的顶点数
    const boneVertexCount = useMemo(() => {
        if (!modelData || !modelData.Geosets || selectedNodeIds.length !== 1) return 0
        const boneId = selectedNodeIds[0]
        let count = 0
        modelData.Geosets.forEach((geoset: any) => {
            if (!geoset.VertexGroup || !geoset.Groups) return
            geoset.VertexGroup.forEach((groupIdx: number) => {
                const group = geoset.Groups[groupIdx]
                if (group && Array.isArray(group) && group.includes(boneId)) count++
            })
        })
        return count
    }, [modelData, selectedNodeIds])

    // 计算当前选中顶点绑定的骨骼
    const boundBones = useMemo(() => {
        if (!modelData || !modelData.Geosets || selectedVertexIds.length === 0) return []
        const boneMap = new Map<number, string>()
        selectedVertexIds.forEach(sel => {
            const geoset = modelData.Geosets![sel.geosetIndex]
            if (!geoset || !geoset.VertexGroup || !geoset.Groups) return
            const matrixGroupIndex = geoset.VertexGroup[sel.index]
            if (matrixGroupIndex === undefined || matrixGroupIndex < 0 || matrixGroupIndex >= geoset.Groups.length) return
            const matrixGroup = geoset.Groups[matrixGroupIndex] as any
            if (matrixGroup && Array.isArray(matrixGroup)) {
                matrixGroup.forEach((nodeIndex: number) => {
                    const node = safeNodes.find((n: any) => n && n.ObjectId === nodeIndex)
                    if (node) boneMap.set(nodeIndex, node.Name)
                })
            }
        })
        return Array.from(boneMap.entries()).map(([index, name]) => ({ index, name }))
    }, [modelData, safeNodes, selectedVertexIds])

    // 插值数据
    const translationLocal = useMemo(() => {
        if (!selectedNode) return [0, 0, 0]
        return interpolateTranslation(selectedNode.Translation?.Keys, currentFrame)
    }, [selectedNode, currentFrame])

    const rotation = useMemo(() => {
        if (!selectedNode) return [0, 0, 0, 1]
        return interpolateRotation(selectedNode.Rotation?.Keys, currentFrame)
    }, [selectedNode, currentFrame])

    const scaling = useMemo(() => {
        if (!selectedNode) return [1, 1, 1]
        return interpolateScaling(selectedNode.Scaling?.Keys, currentFrame)
    }, [selectedNode, currentFrame])

    const euler = useMemo(() => quatToEuler(rotation), [rotation])

    const translationWorld = useMemo(() => {
        if (!selectedNode) return [0, 0, 0]
        const worldPos = (window as any)._selectedBoneWorldPos
        if (worldPos && Array.isArray(worldPos) && worldPos.length === 3) {
            return worldPos as [number, number, number]
        }
        return translationLocal as [number, number, number]
    }, [selectedNode, translationLocal, worldTick])

    const translationDisplay = translationSpace === 'world' ? translationWorld : translationLocal

    // 精确关键帧检查
    const hasExactKey = useCallback((propName: string) => {
        const node = selectedNode as any
        if (!node || !node[propName]?.Keys) return false
        const frame = Math.round(currentFrame)
        return node[propName].Keys.some((k: any) => Math.abs(k.Frame - frame) < 0.1)
    }, [selectedNode, currentFrame])

    // Refs
    const transRefs = useRef<{ x: HTMLInputElement | null, y: HTMLInputElement | null, z: HTMLInputElement | null }>({ x: null, y: null, z: null })
    const rotRefs = useRef<{ x: HTMLInputElement | null, y: HTMLInputElement | null, z: HTMLInputElement | null }>({ x: null, y: null, z: null })
    const scaleRefs = useRef<{ x: HTMLInputElement | null, y: HTMLInputElement | null, z: HTMLInputElement | null }>({ x: null, y: null, z: null })
    const transAddRefs = useRef<{ x: HTMLInputElement | null, y: HTMLInputElement | null, z: HTMLInputElement | null }>({ x: null, y: null, z: null })
    const rotAddRefs = useRef<{ x: HTMLInputElement | null, y: HTMLInputElement | null, z: HTMLInputElement | null }>({ x: null, y: null, z: null })
    const scaleAddRefs = useRef<{ x: HTMLInputElement | null, y: HTMLInputElement | null, z: HTMLInputElement | null }>({ x: null, y: null, z: null })
    const isEditingRef = useRef(false)

    // 同步到输入框
    useEffect(() => {
        if (isEditingRef.current) return
        if (transRefs.current.x) transRefs.current.x.value = formatInputNumber(translationDisplay[0] || 0, 4)
        if (transRefs.current.y) transRefs.current.y.value = formatInputNumber(translationDisplay[1] || 0, 4)
        if (transRefs.current.z) transRefs.current.z.value = formatInputNumber(translationDisplay[2] || 0, 4)

        if (rotRefs.current.x) rotRefs.current.x.value = formatInputNumber(euler[0] || 0, 2)
        if (rotRefs.current.y) rotRefs.current.y.value = formatInputNumber(euler[1] || 0, 2)
        if (rotRefs.current.z) rotRefs.current.z.value = formatInputNumber(euler[2] || 0, 2)

        if (scaleRefs.current.x) scaleRefs.current.x.value = formatInputNumber(scaling[0] || 0, 4)
        if (scaleRefs.current.y) scaleRefs.current.y.value = formatInputNumber(scaling[1] || 0, 4)
        if (scaleRefs.current.z) scaleRefs.current.z.value = formatInputNumber(scaling[2] || 0, 4)

            ; (['x', 'y', 'z'] as const).forEach((axis) => {
                if (transAddRefs.current[axis]) transAddRefs.current[axis]!.value = ''
                if (rotAddRefs.current[axis]) rotAddRefs.current[axis]!.value = ''
                if (scaleAddRefs.current[axis]) scaleAddRefs.current[axis]!.value = ''
            })
    }, [translationDisplay, euler, scaling])

    useEffect(() => {
        if (!renderer || selectedNodeIds.length === 0) return
        if (translationSpace !== 'world') return
        renderer.update(0)
        setWorldTick((tick) => tick + 1)
    }, [renderer, selectedNodeIds, currentFrame, translationSpace])

    useEffect(() => {
        const onResize = () => setViewportHeight(window.innerHeight)
        window.addEventListener('resize', onResize)
        return () => window.removeEventListener('resize', onResize)
    }, [])

    const handleFocus = useCallback(() => { isEditingRef.current = true }, [])

    // 核心提交逻辑
    const commitProp = useCallback((propName: 'Translation' | 'Rotation' | 'Scaling', newVector: number[]) => {
        if (!selectedNode) return
        const nodeId = selectedNode.ObjectId
        const frame = Math.round(currentFrame)
        const { nodes, updateNodeSilent } = useModelStore.getState()
        const storeNode = (Array.isArray(nodes) ? nodes : []).find((n: any) => n && n.ObjectId === nodeId) as any
        if (!storeNode) return

        const existingProp = storeNode[propName] || { Keys: [], InterpolationType: 1 }
        const keys = [...(existingProp.Keys || [])]
        const idx = keys.findIndex(k => Math.abs(k.Frame - frame) < 0.1)

        let newKey: any = { Frame: frame, Vector: newVector }
        const interpolationType = existingProp.InterpolationType || 1
        if (interpolationType > 1) {
            if (idx >= 0) {
                const old = keys[idx]
                if (old.InTan) newKey.InTan = [...old.InTan]
                else newKey.InTan = propName === 'Rotation' ? [0, 0, 0, 0] : [0, 0, 0]
                if (old.OutTan) newKey.OutTan = [...old.OutTan]
                else newKey.OutTan = propName === 'Rotation' ? [0, 0, 0, 0] : [0, 0, 0]
            } else {
                newKey.InTan = propName === 'Rotation' ? [0, 0, 0, 0] : [0, 0, 0]
                newKey.OutTan = propName === 'Rotation' ? [0, 0, 0, 0] : [0, 0, 0]
            }
        }

        if (idx >= 0) keys[idx] = newKey
        else { keys.push(newKey); keys.sort((a, b) => a.Frame - b.Frame) }

        updateNodeSilent(nodeId, { [propName]: { ...existingProp, Keys: keys } })
        if (renderer?.model?.Nodes) {
            const rNode = renderer.model.Nodes.find((n: any) => n && n.ObjectId === nodeId) as any
            if (rNode) rNode[propName] = { ...existingProp, Keys: keys }
        }
        message.success(`已更新 ${propName} 关键帧（帧 ${frame}）`)
    }, [selectedNode, currentFrame, renderer])

    const handleCommitTrans = () => {
        const val: [number, number, number] = [
            parseFloat(transRefs.current.x?.value || '0') || 0,
            parseFloat(transRefs.current.y?.value || '0') || 0,
            parseFloat(transRefs.current.z?.value || '0') || 0
        ]
        if (translationSpace === 'world' && selectedNode) {
            const currentWorld = translationDisplay
            const worldDelta: [number, number, number] = [
                val[0] - (currentWorld[0] || 0),
                val[1] - (currentWorld[1] || 0),
                val[2] - (currentWorld[2] || 0)
            ]
            const localDelta = worldDeltaToLocalDelta(renderer, selectedNode.ObjectId, worldDelta)
            const newLocal: [number, number, number] = [
                translationLocal[0] + localDelta[0],
                translationLocal[1] + localDelta[1],
                translationLocal[2] + localDelta[2]
            ]
            commitProp('Translation', newLocal)
        } else {
            commitProp('Translation', val)
        }
        isEditingRef.current = false
    }

    const handleCommitRot = () => {
        const e: [number, number, number] = [
            parseFloat(rotRefs.current.x?.value || '0') || 0,
            parseFloat(rotRefs.current.y?.value || '0') || 0,
            parseFloat(rotRefs.current.z?.value || '0') || 0
        ]
        const q = eulerToQuat(e)
        commitProp('Rotation', q)
        isEditingRef.current = false
    }

    const handleCommitScale = () => {
        const val: [number, number, number] = [
            parseFloat(scaleRefs.current.x?.value || '1') || 1,
            parseFloat(scaleRefs.current.y?.value || '1') || 1,
            parseFloat(scaleRefs.current.z?.value || '1') || 1
        ]
        commitProp('Scaling', val)
        isEditingRef.current = false
    }



    // 可用的父节点列表
    const availableParents = useMemo(() => {
        if (!safeNodes) return []
        return safeNodes
            .filter((n: any) => !selectedNode || n.ObjectId !== selectedNode.ObjectId)
            .map((n: any) => ({ label: `${n.Name} (${n.ObjectId})`, value: n.ObjectId }))
    }, [safeNodes, selectedNode])

    const handleParentChange = (value: number | undefined) => {
        if (!renderer || !selectedNode) return
        executeCommand(new SetNodeParentCommand(renderer, selectedNode.ObjectId, value))
        message.success('已修改父节点')
    }


    // 紧凑 UI 布局参数
    const isKeyframeCompact = viewportHeight < 900
    const compactUi = useMemo(() => ({
        statPadding: isKeyframeCompact ? '4px 8px' : '6px 10px',
        statFontSize: isKeyframeCompact ? '10px' : '11px',
        sectionPadding: isKeyframeCompact ? '6px 8px' : '8px 10px',
        sectionTitleSize: isKeyframeCompact ? '12px' : '13px',
        toggleGap: isKeyframeCompact ? 4 : 6,
        toggleFontSize: isKeyframeCompact ? 10 : 11,
        togglePadding: isKeyframeCompact ? '1px 6px' : '2px 6px',
        topGap: isKeyframeCompact ? 8 : 10,
        nodeNameMarginBottom: isKeyframeCompact ? 8 : 12,
        nodeNameFontSize: isKeyframeCompact ? '11px' : '12px',
        groupMarginBottom: isKeyframeCompact ? 8 : 12,
        groupTopMargin: isKeyframeCompact ? 2 : 4,
        fieldFontSize: isKeyframeCompact ? '10px' : '11px',
        axisFontSize: isKeyframeCompact ? '10px' : '11px',
        axisMarginRight: isKeyframeCompact ? 6 : 8,
        inputMarginBottom: isKeyframeCompact ? 2 : 4,
        inputPadding: isKeyframeCompact ? '2px 6px' : '4px 8px',
        inputFontSize: isKeyframeCompact ? '11px' : '12px',
        interpSelectWidth: isKeyframeCompact ? 64 : 70,
        parentMarginBottom: isKeyframeCompact ? 8 : 10,
        controlMarginTop: isKeyframeCompact ? 2 : 4,
        geosetRowGap: isKeyframeCompact ? 4 : 6
    }), [isKeyframeCompact])

    // --- 渲染部分 ---

    // 输入行渲染：左侧主值，右侧叠加值（输入后主值 += 叠加值）
    const renderInputRow = (
        _label: string,
        refs: React.MutableRefObject<{ x: HTMLInputElement | null, y: HTMLInputElement | null, z: HTMLInputElement | null }>,
        addRefs: React.MutableRefObject<{ x: HTMLInputElement | null, y: HTMLInputElement | null, z: HTMLInputElement | null }>,
        axis: 'x' | 'y' | 'z',
        color: string,
        onCommit: () => void,
        disabled?: boolean,
        digits: number = 5,
        unit: string = ''
    ) => {
        const applyAdditiveValue = () => {
            if (disabled) return
            const baseInput = refs.current[axis]
            const addInput = addRefs.current[axis]
            if (!baseInput || !addInput) return

            const addText = addInput.value.trim()
            if (addText.length === 0) return

            const base = Number(baseInput.value)
            const add = Number(addText)
            if (!Number.isFinite(add)) {
                addInput.value = ''
                return
            }

            const next = (Number.isFinite(base) ? base : 0) + add
            baseInput.value = formatInputNumber(next, digits)
            addInput.value = ''
            onCommit()
        }

        return (
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: compactUi.inputMarginBottom }}>
                <span style={{ color: disabled ? '#555' : color, marginRight: compactUi.axisMarginRight, fontSize: compactUi.axisFontSize, width: 12 }}>{axis.toUpperCase()}</span>
                <div style={{ flex: 1, display: 'flex', gap: 6 }}>
                    <div style={{ position: 'relative', width: '50%' }}>
                        <input
                            ref={el => refs.current[axis] = el}
                            type="text"
                            inputMode="decimal"
                            disabled={disabled}
                            onFocus={handleFocus}
                            onBlur={onCommit}
                            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') onCommit() }}
                            style={{
                                width: '100%',
                                background: disabled ? '#252525' : '#1f1f1f',
                                border: disabled ? '1px solid #333' : '1px solid #444',
                                borderRadius: 4,
                                color: disabled ? '#555' : '#fff',
                                paddingTop: isKeyframeCompact ? 2 : 4,
                                paddingBottom: isKeyframeCompact ? 2 : 4,
                                paddingLeft: isKeyframeCompact ? 6 : 8,
                                paddingRight: unit ? 18 : (isKeyframeCompact ? 6 : 8),
                                fontSize: compactUi.inputFontSize,
                                outline: 'none',
                                cursor: disabled ? 'not-allowed' : 'text',
                                boxSizing: 'border-box'
                            }}
                        />
                        {unit && (
                            <span
                                style={{
                                    position: 'absolute',
                                    right: 6,
                                    top: '50%',
                                    transform: 'translateY(-50%)',
                                    color: disabled ? '#555' : '#888',
                                    fontSize: compactUi.inputFontSize,
                                    pointerEvents: 'none'
                                }}
                            >
                                {unit}
                            </span>
                        )}
                    </div>
                    <div style={{ position: 'relative', width: '50%' }}>
                        <input
                            ref={el => addRefs.current[axis] = el}
                            type="text"
                            inputMode="decimal"
                            disabled={disabled}
                            placeholder="+叠加值"
                            onFocus={handleFocus}
                            onBlur={applyAdditiveValue}
                            onKeyDown={(e) => {
                                e.stopPropagation()
                                if (e.key === 'Enter') {
                                    e.preventDefault()
                                    applyAdditiveValue()
                                }
                            }}
                            style={{
                                width: '100%',
                                background: disabled ? '#252525' : '#1f1f1f',
                                border: disabled ? '1px solid #333' : '1px solid #444',
                                borderRadius: 4,
                                color: disabled ? '#555' : '#fff',
                                paddingTop: isKeyframeCompact ? 2 : 4,
                                paddingBottom: isKeyframeCompact ? 2 : 4,
                                paddingLeft: isKeyframeCompact ? 6 : 8,
                                paddingRight: unit ? 18 : (isKeyframeCompact ? 6 : 8),
                                fontSize: compactUi.inputFontSize,
                                outline: 'none',
                                cursor: disabled ? 'not-allowed' : 'text',
                                boxSizing: 'border-box'
                            }}
                        />
                        {unit && (
                            <span
                                style={{
                                    position: 'absolute',
                                    right: 6,
                                    top: '50%',
                                    transform: 'translateY(-50%)',
                                    color: disabled ? '#555' : '#888',
                                    fontSize: compactUi.inputFontSize,
                                    pointerEvents: 'none'
                                }}
                            >
                                {unit}
                            </span>
                        )}
                    </div>
                </div>
            </div>
        )
    }

    // 是否禁用输入（未选中单个骨骼时）
    const isInputDisabled = !selectedNode
    const globalSequences = (modelData as any)?.GlobalSequences || []
    const isGeosetPanelMode = animationSubMode === 'keyframe' && timelineKeyframeDisplayMode === 'geosetAnim'
    const geosetPanelBottom = Math.min(180, Math.max(130, Math.round(viewportHeight * 0.2))) + 10

    return (
        <>
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column', backgroundColor: '#2b2b2b', color: '#eee' }}>
                {/* 统计信息 */}
                <div style={{ padding: compactUi.statPadding, borderBottom: '1px solid #444', backgroundColor: '#333' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: compactUi.statFontSize }}>
                        <span style={{ color: '#aaa' }}>选中顶点: <span style={{ color: '#52c41a', fontWeight: 'bold' }}>{selectedVertexIds.length}</span></span>
                        {selectedNodeIds.length === 1 && <span style={{ color: '#aaa' }}>骨骼绑定: <span style={{ color: '#1890ff', fontWeight: 'bold' }}>{boneVertexCount}</span></span>}
                    </div>
                </div>

                {/* 节点参数 */}
                <div style={{ padding: compactUi.sectionPadding, borderBottom: '1px solid #444' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text strong style={{ color: '#fff', fontSize: compactUi.sectionTitleSize }}>节点参数</Text>
                        <div style={{ display: 'flex', gap: compactUi.toggleGap }}>
                            <button
                                type="button"
                                onClick={() => setTranslationSpace('world')}
                                style={{
                                    background: translationSpace === 'world' ? '#1890ff' : '#1f1f1f',
                                    border: '1px solid #3a3a3a',
                                    color: translationSpace === 'world' ? '#fff' : '#aaa',
                                    fontSize: compactUi.toggleFontSize,
                                    padding: compactUi.togglePadding,
                                    borderRadius: 4,
                                    cursor: 'pointer'
                                }}
                            >
                                {"\u4e16\u754c"}
                            </button>
                            <button
                                type="button"
                                onClick={() => setTranslationSpace('local')}
                                style={{
                                    background: translationSpace === 'local' ? '#1890ff' : '#1f1f1f',
                                    border: '1px solid #3a3a3a',
                                    color: translationSpace === 'local' ? '#fff' : '#aaa',
                                    fontSize: compactUi.toggleFontSize,
                                    padding: compactUi.togglePadding,
                                    borderRadius: 4,
                                    cursor: 'pointer'
                                }}
                            >
                                {"\u76f8\u5bf9"}
                            </button>
                        </div>
                    </div>

                    <div style={{ marginTop: compactUi.topGap }}>
                        {/* 节点名称 */}
                        <div style={{ marginBottom: compactUi.nodeNameMarginBottom, color: selectedNode ? '#aaa' : '#555', fontSize: compactUi.nodeNameFontSize }}>
                            {selectedNode ? (selectedNode.Name + ' (' + selectedNode.type + ')') : (
                                selectedNodeIds.length === 0 ? '未选择骨骼' : ('已选择 ' + selectedNodeIds.length + ' 个骨骼')
                            )}
                        </div>

                        {/* Translation */}
                        <div style={{ marginBottom: compactUi.groupMarginBottom }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <Text style={{ color: isInputDisabled ? '#555' : '#888', fontSize: compactUi.fieldFontSize }}>位移 (Translation) {selectedNode && hasExactKey('Translation') && <span style={{ color: '#52c41a', marginLeft: 4 }}>●</span>}</Text>
                                <Select
                                    size="small"
                                    value={selectedNode?.Translation?.InterpolationType ?? 1}
                                    disabled={isInputDisabled}
                                    onChange={(val) => {
                                        if (!selectedNode) return
                                        const node = selectedNode as any
                                        const { updateNodeSilent } = useModelStore.getState()
                                        updateNodeSilent(node.ObjectId, { Translation: { ...(node.Translation || { Keys: [] }), InterpolationType: val } })
                                        if (renderer) renderer.update(0)
                                    }}
                                    style={{ width: compactUi.interpSelectWidth, fontSize: '10px' }}
                                    dropdownStyle={{ minWidth: 80 }}
                                >
                                    <Select.Option value={0}>无</Select.Option>
                                    <Select.Option value={1}>线性</Select.Option>
                                    <Select.Option value={2}>平滑</Select.Option>
                                    <Select.Option value={3}>贝塞尔</Select.Option>
                                </Select>
                            </div>
                            <div style={{ marginTop: compactUi.groupTopMargin }}>
                                {renderInputRow('X', transRefs, transAddRefs, 'x', '#ff4d4f', handleCommitTrans, isInputDisabled, 5)}
                                {renderInputRow('Y', transRefs, transAddRefs, 'y', '#52c41a', handleCommitTrans, isInputDisabled, 5)}
                                {renderInputRow('Z', transRefs, transAddRefs, 'z', '#1890ff', handleCommitTrans, isInputDisabled, 5)}
                            </div>
                        </div>

                        {/* Rotation */}
                        <div style={{ marginBottom: compactUi.groupMarginBottom }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <Text style={{ color: isInputDisabled ? '#555' : '#888', fontSize: compactUi.fieldFontSize }}>旋转 (Rotation) {selectedNode && hasExactKey('Rotation') && <span style={{ color: '#52c41a', marginLeft: 4 }}>●</span>}</Text>
                                <Select
                                    size="small"
                                    value={selectedNode?.Rotation?.InterpolationType ?? 1}
                                    disabled={isInputDisabled}
                                    onChange={(val) => {
                                        if (!selectedNode) return
                                        const node = selectedNode as any
                                        const { updateNodeSilent } = useModelStore.getState()
                                        updateNodeSilent(node.ObjectId, { Rotation: { ...(node.Rotation || { Keys: [] }), InterpolationType: val } })
                                        if (renderer) renderer.update(0)
                                    }}
                                    style={{ width: compactUi.interpSelectWidth, fontSize: '10px' }}
                                    dropdownStyle={{ minWidth: 80 }}
                                >
                                    <Select.Option value={0}>无</Select.Option>
                                    <Select.Option value={1}>线性</Select.Option>
                                    <Select.Option value={2}>平滑</Select.Option>
                                    <Select.Option value={3}>贝塞尔</Select.Option>
                                </Select>
                            </div>
                            <div style={{ marginTop: compactUi.groupTopMargin }}>
                                {renderInputRow('X', rotRefs, rotAddRefs, 'x', '#ff4d4f', handleCommitRot, isInputDisabled, 2, '°')}
                                {renderInputRow('Y', rotRefs, rotAddRefs, 'y', '#52c41a', handleCommitRot, isInputDisabled, 2, '°')}
                                {renderInputRow('Z', rotRefs, rotAddRefs, 'z', '#1890ff', handleCommitRot, isInputDisabled, 2, '°')}
                            </div>
                        </div>

                        {/* Scaling */}
                        <div style={{ marginBottom: compactUi.groupMarginBottom }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <Text style={{ color: isInputDisabled ? '#555' : '#888', fontSize: compactUi.fieldFontSize }}>缩放 (Scaling) {selectedNode && hasExactKey('Scaling') && <span style={{ color: '#52c41a', marginLeft: 4 }}>●</span>}</Text>
                                <Select
                                    size="small"
                                    value={selectedNode?.Scaling?.InterpolationType ?? 1}
                                    disabled={isInputDisabled}
                                    onChange={(val) => {
                                        if (!selectedNode) return
                                        const node = selectedNode as any
                                        const { updateNodeSilent } = useModelStore.getState()
                                        updateNodeSilent(node.ObjectId, { Scaling: { ...(node.Scaling || { Keys: [] }), InterpolationType: val } })
                                        if (renderer) renderer.update(0)
                                    }}
                                    style={{ width: compactUi.interpSelectWidth, fontSize: '10px' }}
                                    dropdownStyle={{ minWidth: 80 }}
                                >
                                    <Select.Option value={0}>无</Select.Option>
                                    <Select.Option value={1}>线性</Select.Option>
                                    <Select.Option value={2}>平滑</Select.Option>
                                    <Select.Option value={3}>贝塞尔</Select.Option>
                                </Select>
                            </div>
                            <div style={{ marginTop: compactUi.groupTopMargin }}>
                                {renderInputRow('X', scaleRefs, scaleAddRefs, 'x', '#ff4d4f', handleCommitScale, isInputDisabled, 5)}
                                {renderInputRow('Y', scaleRefs, scaleAddRefs, 'y', '#52c41a', handleCommitScale, isInputDisabled, 5)}
                                {renderInputRow('Z', scaleRefs, scaleAddRefs, 'z', '#1890ff', handleCommitScale, isInputDisabled, 5)}
                            </div>
                        </div>

                        {/* 父节点 */}
                        <div style={{ marginBottom: compactUi.parentMarginBottom }}>
                            <Text style={{ color: isInputDisabled ? '#555' : '#888', fontSize: compactUi.fieldFontSize }}>父节点</Text>
                            <Select
                                style={{ width: '100%', marginTop: compactUi.controlMarginTop }}
                                size="small"
                                placeholder="无父节点"
                                allowClear
                                showSearch
                                optionFilterProp="label"
                                value={selectedNode?.Parent === -1 ? undefined : selectedNode?.Parent}
                                onChange={handleParentChange}
                                options={availableParents}
                                disabled={isInputDisabled || !renderer}
                            />
                        </div>

                    </div>
                </div>


                {/* 绑定骨骼列表 - 仅在绑定模式显示 */}
                {animationSubMode === 'binding' && (
                    <div style={{ flex: 1, overflow: 'auto', padding: '10px' }}>
                        <Text strong style={{ color: '#fff', fontSize: '13px' }}>绑定骨骼 ({boundBones.length})</Text>
                        {boundBones.length === 0 ? (
                            <div style={{ marginTop: 10, color: '#666', fontSize: '12px', textAlign: 'center', padding: '20px 0' }}>未选择顶点或无绑定</div>
                        ) : (
                            <div style={{ marginTop: 10 }}>
                                {boundBones.map(bone => (
                                    <div key={bone.index} onClick={() => selectNodes([bone.index])}
                                        style={{
                                            padding: '6px 8px', cursor: 'pointer', fontSize: '12px', marginBottom: 2, borderRadius: 2, display: 'flex', alignItems: 'center',
                                            backgroundColor: selectedNodeIds.includes(bone.index) ? 'rgba(24, 144, 255, 0.3)' : 'transparent',
                                            border: selectedNodeIds.includes(bone.index) ? '1px solid #1890ff' : '1px solid transparent',
                                        }}>
                                        <span style={{ width: 8, height: 8, borderRadius: '50%', marginRight: 8, display: 'inline-block', backgroundColor: selectedNodeIds.includes(bone.index) ? '#1890ff' : '#52c41a' }} />
                                        {bone.name}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>


        </>
    )
}

export default React.memo(BoneParameterPanel)

