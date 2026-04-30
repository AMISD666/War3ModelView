export const NODE_VISIBILITY_TYPES = [
    'Bone',
    'Helper',
    'Attachment',
    'ParticleEmitter',
    'ParticleEmitter2',
    'RibbonEmitter',
    'Light',
    'EventObject',
    'CollisionShape',
] as const

export type NodeVisibilityType = typeof NODE_VISIBILITY_TYPES[number]
export type NodeTypeVisibilitySettings = Record<NodeVisibilityType, boolean>

export const NODE_VISIBILITY_LABELS: Record<NodeVisibilityType, string> = {
    Bone: '骨骼',
    Helper: '帮助体',
    Attachment: '挂接点',
    ParticleEmitter: '粒子1',
    ParticleEmitter2: '粒子2',
    RibbonEmitter: '丝带',
    Light: '灯光',
    EventObject: '事件',
    CollisionShape: '碰撞体',
}

export const createDefaultNodeTypeVisibility = (): NodeTypeVisibilitySettings =>
    NODE_VISIBILITY_TYPES.reduce((settings, type) => {
        settings[type] = true
        return settings
    }, {} as NodeTypeVisibilitySettings)

export const createNodeTypeVisibility = (visible: boolean): NodeTypeVisibilitySettings =>
    NODE_VISIBILITY_TYPES.reduce((settings, type) => {
        settings[type] = visible
        return settings
    }, {} as NodeTypeVisibilitySettings)

export const normalizeNodeVisibilityType = (node: any): NodeVisibilityType | null => {
    const type = String(node?.type ?? '')
    if ((NODE_VISIBILITY_TYPES as readonly string[]).includes(type)) return type as NodeVisibilityType
    if (node?.GeosetId !== undefined || node?.GeosetAnimId !== undefined) return 'Bone'
    if (node?.AttachmentID !== undefined) return 'Attachment'
    if (node?.LightType !== undefined) return 'Light'
    if (node?.EventTrack !== undefined) return 'EventObject'
    if (node?.Shape !== undefined || node?.ShapeType !== undefined) return 'CollisionShape'
    return null
}

export const isNodeTypeVisible = (node: any, settings: Partial<NodeTypeVisibilitySettings> | undefined): boolean => {
    const type = normalizeNodeVisibilityType(node)
    return !type || settings?.[type] !== false
}

export const filterVisibleRendererNodes = (
    rendererNodes: any[] | undefined,
    hiddenNodeIds: Set<number> | null,
    typeVisibility: Partial<NodeTypeVisibilitySettings> | undefined
): any[] => {
    if (!Array.isArray(rendererNodes)) return []
    return rendererNodes.filter((nodeWrapper) => {
        const node = nodeWrapper?.node
        const nodeId = Number(node?.ObjectId)
        if (hiddenNodeIds && Number.isFinite(nodeId) && hiddenNodeIds.has(nodeId)) return false
        return isNodeTypeVisible(node, typeVisibility)
    })
}
