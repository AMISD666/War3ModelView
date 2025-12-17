import React, { useMemo, useCallback, useRef, useEffect } from 'react'
import { Typography, Select, message } from 'antd'
import { useSelectionStore } from '../../store/selectionStore'
import { useModelStore } from '../../store/modelStore'
import { useRendererStore } from '../../store/rendererStore'
import { SetNodeParentCommand } from '../../commands/SetNodeParentCommand'
import { useCommandManager } from '../../utils/CommandManager'

const { Text } = Typography

// 插值函数：获取指定帧的 Translation 值
const interpolateTranslation = (keys: any[], frame: number): number[] => {
    if (!keys || keys.length === 0) return [0, 0, 0]

    const sortedKeys = [...keys].sort((a: any, b: any) => a.Frame - b.Frame)

    const toArray = (v: any): number[] => {
        if (!v) return [0, 0, 0]
        if (Array.isArray(v)) return [...v]
        if (v.length !== undefined) return Array.from(v) as number[]
        return [0, 0, 0]
    }

    if (frame <= sortedKeys[0].Frame) {
        return toArray(sortedKeys[0].Vector)
    }
    if (frame >= sortedKeys[sortedKeys.length - 1].Frame) {
        return toArray(sortedKeys[sortedKeys.length - 1].Vector)
    }

    for (let i = 0; i < sortedKeys.length - 1; i++) {
        if (frame >= sortedKeys[i].Frame && frame <= sortedKeys[i + 1].Frame) {
            const t = (frame - sortedKeys[i].Frame) / (sortedKeys[i + 1].Frame - sortedKeys[i].Frame)
            const from = toArray(sortedKeys[i].Vector)
            const to = toArray(sortedKeys[i + 1].Vector)
            return from.map((v, idx) => v + (to[idx] - v) * t)
        }
    }

    return [0, 0, 0]
}

/**
 * 骨骼参数面板 - 显示选中骨骼的 Translation 信息和绑定骨骼列表
 */
const BoneParameterPanel: React.FC = () => {
    const selectedNodeIds = useSelectionStore(state => state.selectedNodeIds)
    const selectNodes = useSelectionStore(state => state.selectNodes)
    const selectedVertexIds = useSelectionStore(state => state.selectedVertexIds)
    const nodes = useModelStore(state => state.nodes)
    const modelData = useModelStore(state => state.modelData)
    const currentFrame = useModelStore(state => state.currentFrame)

    const renderer = useRendererStore(state => state.renderer)
    const { executeCommand } = useCommandManager()

    // 获取选中的骨骼节点
    const selectedNode = selectedNodeIds.length === 1
        ? nodes.find((n: any) => n.ObjectId === selectedNodeIds[0])
        : null

    // 计算该骨骼绑定的顶点数量
    const boneVertexCount = useMemo(() => {
        if (!modelData || !modelData.Geosets || selectedNodeIds.length !== 1) return 0
        const boneId = selectedNodeIds[0]
        let count = 0

        modelData.Geosets.forEach((geoset: any) => {
            if (!geoset.VertexGroup || !geoset.Groups) return
            geoset.VertexGroup.forEach((groupIdx: number) => {
                const group = geoset.Groups[groupIdx]
                if (group && Array.isArray(group) && group.includes(boneId)) {
                    count++
                }
            })
        })

        return count
    }, [modelData, selectedNodeIds])

    // 计算绑定骨骼
    const boundBones = useMemo(() => {
        if (!modelData || !modelData.Geosets || selectedVertexIds.length === 0) return []

        const boneMap = new Map<number, string>()

        selectedVertexIds.forEach(sel => {
            const geoset = modelData.Geosets![sel.geosetIndex]
            if (!geoset || !geoset.VertexGroup || !geoset.Groups) return

            const matrixGroupIndex = geoset.VertexGroup[sel.index]
            if (matrixGroupIndex === undefined || matrixGroupIndex < 0 || matrixGroupIndex >= geoset.Groups.length) return

            const matrixGroup = geoset.Groups[matrixGroupIndex] as any
            if (!matrixGroup) return

            const matrix = matrixGroup
            if (matrix && Array.isArray(matrix)) {
                matrix.forEach((nodeIndex: number) => {
                    const node = nodes.find((n: any) => n.ObjectId === nodeIndex)
                    if (node) {
                        boneMap.set(nodeIndex, node.Name)
                    }
                })
            }
        })

        return Array.from(boneMap.entries()).map(([index, name]) => ({ index, name }))
    }, [modelData, nodes, selectedVertexIds])

    // 获取当前帧的 Translation 值（插值）
    const translation = useMemo(() => {
        if (!selectedNode) return [0, 0, 0]
        const keys = selectedNode.Translation?.Keys
        if (!keys || keys.length === 0) return [0, 0, 0]
        return interpolateTranslation(keys, currentFrame)
    }, [selectedNode, currentFrame])

    // 检查当前帧是否有精确的关键帧
    const hasExactKeyframe = useMemo(() => {
        if (!selectedNode?.Translation?.Keys) return false
        const frame = Math.round(currentFrame)
        return selectedNode.Translation.Keys.some((k: any) => Math.abs(k.Frame - frame) < 0.1)
    }, [selectedNode, currentFrame])

    // 本地编辑状态 - 使用 ref 来避免 Store 更新导致的重渲染问题
    const inputRefs = useRef<{ x: HTMLInputElement | null, y: HTMLInputElement | null, z: HTMLInputElement | null }>({
        x: null, y: null, z: null
    })
    const isEditingRef = useRef(false)
    const baseValueRef = useRef<[number, number, number]>([0, 0, 0])

    // 同步显示值到输入框（仅当不在编辑时）
    useEffect(() => {
        if (isEditingRef.current) return
        if (inputRefs.current.x) inputRefs.current.x.value = (translation[0] || 0).toFixed(5)
        if (inputRefs.current.y) inputRefs.current.y.value = (translation[1] || 0).toFixed(5)
        if (inputRefs.current.z) inputRefs.current.z.value = (translation[2] || 0).toFixed(5)
    }, [translation])

    // 当用户开始编辑时，记录基础值
    const handleFocus = useCallback(() => {
        isEditingRef.current = true
        baseValueRef.current = [
            parseFloat(inputRefs.current.x?.value || '0') || 0,
            parseFloat(inputRefs.current.y?.value || '0') || 0,
            parseFloat(inputRefs.current.z?.value || '0') || 0
        ]
    }, [])

    // 用户完成编辑时提交到 Store
    const handleCommit = useCallback(() => {
        if (!selectedNode) {
            isEditingRef.current = false
            return
        }

        // 读取当前输入框的值
        const newTranslation: [number, number, number] = [
            parseFloat(inputRefs.current.x?.value || '0') || 0,
            parseFloat(inputRefs.current.y?.value || '0') || 0,
            parseFloat(inputRefs.current.z?.value || '0') || 0
        ]

        const frame = Math.round(currentFrame)
        const nodeId = selectedNode.ObjectId

        // 从 Store 获取最新的节点数据
        const { nodes } = useModelStore.getState()
        const { updateNodeSilent } = useModelStore.getState()
        const storeNode = nodes.find((n: any) => n.ObjectId === nodeId)
        if (!storeNode) {
            isEditingRef.current = false
            return
        }

        // 获取现有的 Translation 属性
        const existingProp = storeNode.Translation || { Keys: [], InterpolationType: 1 }
        const keys = [...(existingProp.Keys || [])]

        // 查找或创建关键帧
        const existingKeyIndex = keys.findIndex((k: any) => Math.abs(k.Frame - frame) < 0.1)
        const interpolationType = existingProp.InterpolationType || 0;

        let newKey: any = { Frame: frame, Vector: newTranslation };

        // 如果是 Hermite (2) 或 Bezier (3) 插值，必须添加切线
        // 否则可能导致插值计算错误（NaN 或 0），从而导致 T-Pose
        if (interpolationType > 1) {
            // 如果已存在关键帧，保留其切线
            if (existingKeyIndex >= 0) {
                const oldKey = keys[existingKeyIndex];
                if (oldKey.InTan) newKey.InTan = [...oldKey.InTan];
                else newKey.InTan = [0, 0, 0];

                if (oldKey.OutTan) newKey.OutTan = [...oldKey.OutTan];
                else newKey.OutTan = [0, 0, 0];
            } else {
                // 新关键帧默认使用 0 切线 (Flat)
                newKey.InTan = [0, 0, 0];
                newKey.OutTan = [0, 0, 0];
            }
        }

        if (existingKeyIndex >= 0) {
            keys[existingKeyIndex] = newKey;
        } else {
            keys.push(newKey)
            keys.sort((a: any, b: any) => a.Frame - b.Frame)
        }

        // 使用 updateNodeSilent 更新 Store（不触发 renderer reload）
        updateNodeSilent(nodeId, {
            Translation: { ...existingProp, Keys: keys }
        })

        // 同步更新 renderer 中的节点数据
        if (renderer && renderer.model && renderer.model.Nodes) {
            const rendererNode = renderer.model.Nodes.find((n: any) => n.ObjectId === nodeId)
            if (rendererNode) {
                rendererNode.Translation = { ...existingProp, Keys: keys }
            }
        }

        isEditingRef.current = false
        message.success(`已更新 Translation 关键帧 (帧 ${frame})`)
    }, [selectedNode, currentFrame, renderer])

    const handleParentChange = (value: number | undefined) => {
        if (!renderer || !selectedNode) return

        const cmd = new SetNodeParentCommand(renderer, selectedNode.ObjectId, value)
        executeCommand(cmd)
        message.success('已修改父节点')
    }

    // Filter nodes for dropdown: exclude self and children (to prevent loops)
    const availableParents = useMemo(() => {
        if (!selectedNode) return []

        // Avoid cyclic dependency: Exclude self and all descendants
        const descendantIds = new Set<number>()
        descendantIds.add(selectedNode.ObjectId)

        const stack = [selectedNode.ObjectId]
        while (stack.length > 0) {
            const currentId = stack.pop()!
            // find children
            const children = nodes.filter((n: any) => n.Parent === currentId)
            children.forEach((c: any) => {
                if (!descendantIds.has(c.ObjectId)) {
                    descendantIds.add(c.ObjectId)
                    stack.push(c.ObjectId)
                }
            })
        }

        return nodes
            .filter((n: any) => !descendantIds.has(n.ObjectId))
            .map((n: any) => ({ label: `${n.Name} (${n.ObjectId})`, value: n.ObjectId }))
    }, [nodes, selectedNode])

    return (
        <div style={{
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: '#2b2b2b',
            color: '#eee'
        }}>
            {/* 顶点统计信息 */}
            <div style={{
                padding: '8px 10px',
                borderBottom: '1px solid #444',
                backgroundColor: '#333'
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                    <span style={{ color: '#aaa' }}>
                        选中顶点: <span style={{ color: '#52c41a', fontWeight: 'bold' }}>{selectedVertexIds.length}</span>
                    </span>
                    {selectedNodeIds.length === 1 && (
                        <span style={{ color: '#aaa' }}>
                            骨骼绑定: <span style={{ color: '#1890ff', fontWeight: 'bold' }}>{boneVertexCount}</span>
                        </span>
                    )}
                </div>
            </div>

            {/* 骨骼参数 */}
            <div style={{ padding: '10px', borderBottom: '1px solid #444' }}>
                <Text strong style={{ color: '#fff', fontSize: '13px' }}>骨骼参数</Text>

                <div style={{ marginTop: 10 }}>
                    {selectedNode ? (
                        <>
                            <div style={{ marginBottom: 8, color: '#aaa', fontSize: '12px' }}>
                                {selectedNode.Name} ({selectedNode.type})
                            </div>
                            <div style={{ marginBottom: 6 }}>
                                <Text style={{ color: '#888', fontSize: '11px' }}>
                                    位移 (Translation)
                                    {hasExactKeyframe && <span style={{ color: '#52c41a', marginLeft: 4 }}>●</span>}
                                </Text>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                                    <div style={{ display: 'flex', alignItems: 'center' }}>
                                        <span style={{ color: '#ff4d4f', marginRight: 8, fontSize: '11px', width: 12 }}>X</span>
                                        <input
                                            ref={el => inputRefs.current.x = el}
                                            type="number"
                                            step="0.1"
                                            defaultValue={(translation[0] || 0).toFixed(5)}
                                            onFocus={handleFocus}
                                            onBlur={handleCommit}
                                            onKeyDown={(e) => {
                                                // 阻止事件冒泡，防止触发全局快捷键
                                                e.stopPropagation();
                                                if (e.key === 'Enter') handleCommit();
                                            }}
                                            onChange={() => {/* Controlled by defaultValue */ }}
                                            style={{
                                                flex: 1,
                                                background: '#1f1f1f',
                                                border: '1px solid #444',
                                                borderRadius: 4,
                                                color: '#fff',
                                                padding: '4px 8px',
                                                fontSize: '12px',
                                                outline: 'none'
                                            }}
                                        />
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center' }}>
                                        <span style={{ color: '#52c41a', marginRight: 8, fontSize: '11px', width: 12 }}>Y</span>
                                        <input
                                            ref={el => inputRefs.current.y = el}
                                            type="number"
                                            step="0.1"
                                            defaultValue={(translation[1] || 0).toFixed(5)}
                                            onFocus={handleFocus}
                                            onBlur={handleCommit}
                                            onKeyDown={(e) => {
                                                e.stopPropagation();
                                                if (e.key === 'Enter') handleCommit();
                                            }}
                                            onChange={() => {/* Controlled by defaultValue */ }}
                                            style={{
                                                flex: 1,
                                                background: '#1f1f1f',
                                                border: '1px solid #444',
                                                borderRadius: 4,
                                                color: '#fff',
                                                padding: '4px 8px',
                                                fontSize: '12px',
                                                outline: 'none'
                                            }}
                                        />
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center' }}>
                                        <span style={{ color: '#1890ff', marginRight: 8, fontSize: '11px', width: 12 }}>Z</span>
                                        <input
                                            ref={el => inputRefs.current.z = el}
                                            type="number"
                                            step="0.1"
                                            defaultValue={(translation[2] || 0).toFixed(5)}
                                            onFocus={handleFocus}
                                            onBlur={handleCommit}
                                            onKeyDown={(e) => {
                                                e.stopPropagation();
                                                if (e.key === 'Enter') handleCommit();
                                            }}
                                            onChange={() => {/* Controlled by defaultValue */ }}
                                            style={{
                                                flex: 1,
                                                background: '#1f1f1f',
                                                border: '1px solid #444',
                                                borderRadius: 4,
                                                color: '#fff',
                                                padding: '4px 8px',
                                                fontSize: '12px',
                                                outline: 'none'
                                            }}
                                        />
                                    </div>
                                </div>
                                <div style={{ marginTop: 4, fontSize: '10px', color: '#666' }}>
                                    输入数值或使用 Gizmo 编辑 · 帧 {Math.round(currentFrame)}
                                </div>
                            </div>

                            <div style={{ marginBottom: 6 }}>
                                <Text style={{ color: '#888', fontSize: '11px' }}>父节点</Text>
                                <Select
                                    style={{ width: '100%', marginTop: 4 }}
                                    size="small"
                                    placeholder="无父节点"
                                    allowClear
                                    showSearch
                                    optionFilterProp="label"
                                    value={selectedNode.Parent === -1 ? undefined : selectedNode.Parent}
                                    onChange={handleParentChange}
                                    options={availableParents}
                                    disabled={!renderer}
                                />
                            </div>
                        </>
                    ) : (
                        <div style={{ color: '#666', fontSize: '12px' }}>
                            {selectedNodeIds.length === 0
                                ? '未选择骨骼'
                                : `已选择 ${selectedNodeIds.length} 个骨骼`}
                        </div>
                    )}
                </div>
            </div>

            {/* 绑定骨骼列表 */}
            <div style={{ flex: 1, overflow: 'auto', padding: '10px' }}>
                <Text strong style={{ color: '#fff', fontSize: '13px' }}>
                    绑定骨骼 ({boundBones.length})
                </Text>

                {boundBones.length === 0 ? (
                    <div style={{ marginTop: 10, color: '#666', fontSize: '12px', textAlign: 'center' }}>
                        未选择顶点或无绑定
                    </div>
                ) : (
                    <div style={{ marginTop: 10 }}>
                        {boundBones.map(bone => (
                            <div
                                key={bone.index}
                                onClick={() => selectNodes([bone.index])}
                                style={{
                                    padding: '6px 8px',
                                    cursor: 'pointer',
                                    fontSize: '12px',
                                    backgroundColor: selectedNodeIds.includes(bone.index) ? 'rgba(24, 144, 255, 0.3)' : 'transparent',
                                    border: selectedNodeIds.includes(bone.index) ? '1px solid #1890ff' : '1px solid transparent',
                                    borderRadius: 2,
                                    marginBottom: 2,
                                    display: 'flex',
                                    alignItems: 'center'
                                }}
                            >
                                <span style={{
                                    width: 8,
                                    height: 8,
                                    borderRadius: '50%',
                                    backgroundColor: selectedNodeIds.includes(bone.index) ? '#1890ff' : '#52c41a',
                                    marginRight: 8,
                                    display: 'inline-block'
                                }} />
                                {bone.name}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}

export default React.memo(BoneParameterPanel)
