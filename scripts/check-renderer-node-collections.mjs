import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

const repoRoot = process.cwd()
const require = createRequire(import.meta.url)
const sourcePath = path.join(repoRoot, 'src/renderer/src/application/render/RendererNodeCollections.ts')
const source = fs.readFileSync(sourcePath, 'utf8')
const compiled = ts.transpileModule(source, {
    compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
    },
}).outputText

const sandbox = {
    exports: {},
    module: { exports: {} },
    require,
}
sandbox.exports = sandbox.module.exports
vm.runInNewContext(compiled, sandbox, { filename: sourcePath })

const { applyNodeCollections, buildNodeCollections } = sandbox.module.exports
if (typeof applyNodeCollections !== 'function' || typeof buildNodeCollections !== 'function') {
    throw new Error('RendererNodeCollections exports were not available after transpilation')
}

const bone = {
    type: 'Bone',
    ObjectId: 0,
    Name: 'Bone_GlobalSeq',
    Translation: { Keys: [{ Frame: 0, Vector: [0, 0, 0] }], GlobalSeqId: 1 },
}
const helper = {
    type: 'Helper',
    ObjectId: 1,
    Name: 'Helper_GlobalSeq',
    Rotation: { Keys: [{ Frame: 0, Vector: [0, 0, 0, 1] }], GlobalSeqId: 2 },
}
const emitter = {
    type: 'ParticleEmitter2',
    ObjectId: 2,
    Name: 'Emitter_GlobalSeq',
    Scaling: { Keys: [{ Frame: 0, Vector: [1, 1, 1] }], GlobalSeqId: 0 },
}

const nodes = [bone, helper, emitter]
const collections = buildNodeCollections(nodes)
const model = {
    Nodes: [],
    Bones: [{ ObjectId: 0, Translation: { GlobalSeqId: null } }],
    Helpers: [],
    ParticleEmitters2: [],
}
applyNodeCollections(model, nodes)

const assert = (condition, message) => {
    if (!condition) throw new Error(message)
}

assert(collections.Bones[0] === bone, 'Bone collection does not reuse the latest node object')
assert(collections.Helpers[0] === helper, 'Helper collection does not reuse the latest node object')
assert(collections.ParticleEmitters2[0] === emitter, 'PE2 collection does not reuse the latest node object')
assert(model.Nodes === nodes, 'Renderer model Nodes was not replaced by the latest node array')
assert(model.Bones[0] === bone, 'Renderer model Bones did not receive the latest Bone node')
assert(model.Helpers[0] === helper, 'Renderer model Helpers did not receive the latest Helper node')
assert(
    model.ParticleEmitters2.length === 0,
    'Node projection must not overwrite renderer ParticleEmitters2; PE2 uses the validated scene sync path'
)
assert(model.Bones[0].Translation.GlobalSeqId === 1, 'Bone GlobalSeqId was not hot-projected')
assert(model.Helpers[0].Rotation.GlobalSeqId === 2, 'Helper GlobalSeqId was not hot-projected')

console.log('renderer node collections hot projection ok')
