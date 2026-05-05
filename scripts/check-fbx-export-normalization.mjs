import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'
import { generateMDX, parseMDX } from 'war3-model'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tempDir = path.join(repoRoot, '.tmp', 'fbx-export-normalization-check')

const fail = (message) => {
    throw new Error(message)
}

const transpileRendererModule = async (relativePath, replacements = []) => {
    const sourcePath = path.join(repoRoot, relativePath)
    const source = await import('node:fs/promises').then(({ readFile }) => readFile(sourcePath, 'utf8'))
    let output = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.ES2022,
            target: ts.ScriptTarget.ES2022,
        },
    }).outputText

    for (const [from, to] of replacements) {
        output = output.replace(from, to)
    }

    const outputPath = path.join(tempDir, path.basename(relativePath).replace(/\.ts$/, '.mjs'))
    await writeFile(outputPath, output)
    return outputPath
}

await rm(tempDir, { recursive: true, force: true })
await mkdir(tempDir, { recursive: true })

await transpileRendererModule('src/renderer/src/application/model-save/saveDataCoercion.ts')
const sectionsPath = await transpileRendererModule(
    'src/renderer/src/application/model-save/saveDataSections.ts',
    [[/from '\.\/saveDataCoercion'/g, "from './saveDataCoercion.mjs'"]],
)

const { normalizeModelInfo, normalizeModelVersion } = await import(pathToFileURL(sectionsPath))

const makeLegacyFbxImportedModel = () => ({
    Version: { FormatVersion: 800 },
    Model: {
        Name: 'fbx_export_bridge_fixture',
        BlendTime: 150,
        MinimumExtent: [-8, -4, -2],
        MaximumExtent: [8, 4, 2],
        BoundsRadius: 9,
    },
    Sequences: [],
    GlobalSequences: [],
    Textures: [],
    Materials: [],
    TextureAnims: [],
    Geosets: [],
    GeosetAnims: [],
    Bones: [],
    Lights: [],
    Helpers: [],
    Attachments: [],
    PivotPoints: [],
    ParticleEmitters: [],
    ParticleEmitters2: [],
    ParticleEmitterPopcorns: [],
    RibbonEmitters: [],
    Cameras: [],
    EventObjects: [],
    CollisionShapes: [],
    FaceFX: [],
    BindPoses: [],
})

const model = makeLegacyFbxImportedModel()
normalizeModelVersion(model)
normalizeModelInfo(model)

if (model.Version !== 800) {
    fail(`Expected numeric Version=800, got ${String(model.Version)}`)
}
if (model.Info?.Name !== 'fbx_export_bridge_fixture') {
    fail(`Expected Info.Name from legacy Model.Name, got ${String(model.Info?.Name)}`)
}
if (!(model.Info.MinimumExtent instanceof Float32Array) || !(model.Info.MaximumExtent instanceof Float32Array)) {
    fail('Expected model Info extents to be Float32Array values')
}

const mdxBytes = new Uint8Array(generateMDX(model))
parseMDX(mdxBytes.buffer.slice(mdxBytes.byteOffset, mdxBytes.byteOffset + mdxBytes.byteLength))

console.log(`OK FBX export normalization produced parseable MDX (${mdxBytes.length} bytes).`)
