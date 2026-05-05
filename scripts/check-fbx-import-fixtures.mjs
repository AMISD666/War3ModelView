import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'

const repoRoot = process.cwd()
const bundledFixtureDir = path.join(repoRoot, 'testmodel', 'fbx')
const bundledStaticFixture = path.join(
    bundledFixtureDir,
    'static_mesh',
    'blender_272_cube_7400_binary.fbx',
)
const bundledSkinFixture = path.join(
    bundledFixtureDir,
    'skinning',
    'blender_293_half_skinned_7400_binary.fbx',
)
const bundledAnimationFixture = path.join(
    bundledFixtureDir,
    'animation',
    'maya_anim_linear_7700_ascii.fbx',
)
const fixtureDir = process.env.FBX_FIXTURE_DIR || bundledFixtureDir
const staticFixture = process.env.FBX_STATIC_FIXTURE || bundledStaticFixture
const skinFixture = process.env.FBX_SKIN_FIXTURE || bundledSkinFixture
const animationFixture = process.env.FBX_ANIM_FIXTURE || bundledAnimationFixture

const fail = (message) => {
    throw new Error(message)
}

const collectFbxFiles = async (dir) => {
    const result = []
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
            result.push(...await collectFbxFiles(fullPath))
            continue
        }
        if (entry.isFile() && entry.name.toLowerCase().endsWith('.fbx')) {
            result.push(fullPath)
        }
    }
    return result
}

const dirStat = await stat(fixtureDir).catch(() => null)
if (!dirStat?.isDirectory()) {
    if (process.env.FBX_FIXTURE_DIR) {
        fail(`FBX_FIXTURE_DIR is not a readable directory: ${fixtureDir}`)
    }
    console.log(`FBX fixture check skipped: bundled fixture folder is missing: ${fixtureDir}`)
    console.log('Set FBX_FIXTURE_DIR to a folder containing .fbx files to run this check with external fixtures.')
    process.exit(0)
}

const files = await collectFbxFiles(fixtureDir)
if (files.length === 0) {
    fail(`No .fbx files found under FBX_FIXTURE_DIR: ${fixtureDir}`)
}

console.log(`Found ${files.length} FBX fixture(s):`)
for (const file of files) {
    const fileStat = await stat(file)
    if (fileStat.size <= 0) {
        fail(`FBX fixture is empty: ${file}`)
    }
    console.log(`- ${file} (${fileStat.size} bytes)`)
}

const resolvedStaticFixture = path.resolve(staticFixture)
const isCovered = files.some((file) => path.resolve(file) === resolvedStaticFixture)
const fileStat = await stat(resolvedStaticFixture).catch(() => null)
if (!fileStat?.isFile()) {
    fail(`FBX_STATIC_FIXTURE is not a readable file: ${staticFixture}`)
}
if (fileStat.size <= 0) {
    fail(`FBX_STATIC_FIXTURE is empty: ${staticFixture}`)
}
if (!isCovered) {
    console.warn(`FBX_STATIC_FIXTURE is outside FBX_FIXTURE_DIR: ${staticFixture}`)
}
console.log(`Static import smoke fixture: ${resolvedStaticFixture} (${fileStat.size} bytes)`)
console.log('Run: cargo test --manifest-path src-tauri/Cargo.toml fbx_static_fixture_import_smoke -- --nocapture')

const resolvedSkinFixture = path.resolve(skinFixture)
const skinFileStat = await stat(resolvedSkinFixture).catch(() => null)
if (skinFileStat?.isFile()) {
    if (skinFileStat.size <= 0) {
        fail(`FBX_SKIN_FIXTURE is empty: ${skinFixture}`)
    }
    console.log(`Skin node/bone smoke fixture: ${resolvedSkinFixture} (${skinFileStat.size} bytes)`)
    console.log('Run: cargo test --manifest-path src-tauri/Cargo.toml fbx_skin_fixture_node_bone_smoke -- --nocapture')
} else if (process.env.FBX_SKIN_FIXTURE) {
    fail(`FBX_SKIN_FIXTURE is not a readable file: ${skinFixture}`)
}

const resolvedAnimationFixture = path.resolve(animationFixture)
const animationFileStat = await stat(resolvedAnimationFixture).catch(() => null)
if (animationFileStat?.isFile()) {
    if (animationFileStat.size <= 0) {
        fail(`FBX_ANIM_FIXTURE is empty: ${animationFixture}`)
    }
    console.log(`Animation bake smoke fixture: ${resolvedAnimationFixture} (${animationFileStat.size} bytes)`)
    console.log('Run: cargo test --manifest-path src-tauri/Cargo.toml fbx_animation_fixture_bake_smoke -- --nocapture')
} else if (process.env.FBX_ANIM_FIXTURE) {
    fail(`FBX_ANIM_FIXTURE is not a readable file: ${animationFixture}`)
}

console.log('FBX fixture discovery passed.')
