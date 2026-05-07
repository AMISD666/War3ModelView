import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const entry = `
    import { generate as generateMDX } from './vendor/war3-model/mdx/generate.ts'
    import { normalizeMaterialForSave } from './src/renderer/src/application/model-save/normalizeMaterialLayersForSave.ts'

    const material = {
        Layers: [{
            FilterMode: 'Blend',
            Alpha: { LineType: 1 },
            TextureID: { LineType: 1 },
            NormalTextureID: { GlobalSeqId: null },
            TVertexAnimId: undefined,
            CoordId: 0,
        }],
    }

    normalizeMaterialForSave(material, 1, 0, 0)
    const layer = material.Layers[0]

    if (typeof layer.Alpha !== 'number' || layer.Alpha !== 1) {
        throw new Error('Expected malformed Alpha track to normalize to static 1')
    }

    if (typeof layer.TextureID !== 'number' || layer.TextureID !== -1) {
        throw new Error('Expected malformed TextureID track to normalize to static -1')
    }

    if (typeof layer.NormalTextureID !== 'number' || layer.NormalTextureID !== -1) {
        throw new Error('Expected malformed HD texture track to normalize to static -1')
    }

    const model = {
        Version: 800,
        Info: {
            Name: 'material-layer-save-normalization',
            BlendTime: 150,
            BoundsRadius: 0,
            MinimumExtent: new Float32Array([0, 0, 0]),
            MaximumExtent: new Float32Array([0, 0, 0]),
        },
        Sequences: [],
        GlobalSequences: [],
        Textures: [{ Image: 'ReplaceableTextures\\\\TeamColor\\\\TeamColor00.blp', ReplaceableId: 1, Flags: 0 }],
        Materials: [material],
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
        RibbonEmitters: [],
        EventObjects: [],
        Cameras: [],
        CollisionShapes: [],
    }

    generateMDX(model)
`

const result = await build({
    stdin: {
        contents: entry,
        resolveDir: process.cwd(),
        sourcefile: 'material-layer-save-normalization-entry.ts',
        loader: 'ts',
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
})

const bundled = result.outputFiles[0]?.text
if (!bundled) {
    throw new Error('Failed to bundle material layer save normalization check')
}

await import(`data:text/javascript;base64,${Buffer.from(bundled).toString('base64')}`)
console.log(`material-layer-save-normalization ok (${pathToFileURL(process.cwd()).href})`)
