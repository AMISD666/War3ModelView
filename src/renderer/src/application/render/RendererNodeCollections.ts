export type RendererNode = Record<string, unknown>

export type NodeCollections = {
    Bones: RendererNode[]
    Helpers: RendererNode[]
    Attachments: RendererNode[]
    Lights: RendererNode[]
    ParticleEmitters: RendererNode[]
    ParticleEmitters2: RendererNode[]
    RibbonEmitters: RendererNode[]
    EventObjects: RendererNode[]
    CollisionShapes: RendererNode[]
    Cameras: RendererNode[]
    ParticleEmitterPopcorns: RendererNode[]
}

const createEmptyNodeCollections = (): NodeCollections => ({
    Bones: [],
    Helpers: [],
    Attachments: [],
    Lights: [],
    ParticleEmitters: [],
    ParticleEmitters2: [],
    RibbonEmitters: [],
    EventObjects: [],
    CollisionShapes: [],
    Cameras: [],
    ParticleEmitterPopcorns: [],
})

export const buildNodeCollections = (nodes: RendererNode[]): NodeCollections => {
    const collections = createEmptyNodeCollections()

    nodes.forEach((node) => {
        switch (node.type) {
            case 'Bone':
                collections.Bones.push(node)
                break
            case 'Helper':
                collections.Helpers.push(node)
                break
            case 'Attachment':
                collections.Attachments.push(node)
                break
            case 'Light':
                collections.Lights.push(node)
                break
            case 'ParticleEmitter':
                collections.ParticleEmitters.push(node)
                break
            case 'ParticleEmitter2':
                collections.ParticleEmitters2.push(node)
                break
            case 'RibbonEmitter':
                collections.RibbonEmitters.push(node)
                break
            case 'EventObject':
                collections.EventObjects.push(node)
                break
            case 'CollisionShape':
                collections.CollisionShapes.push(node)
                break
            case 'Camera':
                collections.Cameras.push(node)
                break
            case 'ParticleEmitterPopcorn':
                collections.ParticleEmitterPopcorns.push(node)
                break
            default:
                break
        }
    })

    return collections
}

export const applyNodeCollections = (
    rendererModel: Record<string, unknown>,
    nodes: RendererNode[],
): void => {
    const collections = buildNodeCollections(nodes)

    rendererModel.Nodes = nodes
    rendererModel.Bones = collections.Bones
    rendererModel.Helpers = collections.Helpers
    rendererModel.Attachments = collections.Attachments
    rendererModel.Lights = collections.Lights
    rendererModel.ParticleEmitters = collections.ParticleEmitters
    rendererModel.RibbonEmitters = collections.RibbonEmitters
    rendererModel.EventObjects = collections.EventObjects
    rendererModel.CollisionShapes = collections.CollisionShapes
    rendererModel.Cameras = collections.Cameras
    rendererModel.ParticleEmitterPopcorns = collections.ParticleEmitterPopcorns
}
