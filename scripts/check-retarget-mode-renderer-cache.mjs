import fs from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
const assert = (condition, message) => {
    if (!condition) throw new Error(message)
}

const storeSource = read('src/renderer/src/store/modelStore.ts')
assert(
    storeSource.includes('discardActiveRendererCache: (reason?: string) => void'),
    'modelStore must expose discardActiveRendererCache for mode-boundary renderer cleanup'
)
assert(
    storeSource.includes("markStandalonePerf('renderer.cacheDiscarded'"),
    'discardActiveRendererCache must emit diagnostics for renderer cache cleanup'
)
assert(
    storeSource.includes('rendererReloadTrigger: state.rendererReloadTrigger + 1') &&
        storeSource.includes('materialReloadTrigger: state.materialReloadTrigger + 1'),
    'discardActiveRendererCache must force renderer and material reload on the next Viewer mount'
)
assert(
    storeSource.includes('snapshot: {') &&
        storeSource.includes('renderer: null'),
    'discardActiveRendererCache must remove the active tab snapshot renderer'
)

const mainLayoutSource = read('src/renderer/src/components/MainLayout.tsx')
assert(
    mainLayoutSource.includes('const discardActiveRendererCache = useModelStore(state => state.discardActiveRendererCache)'),
    'MainLayout must subscribe to discardActiveRendererCache'
)
assert(
    mainLayoutSource.includes("mainMode === 'retarget' && previousMainMode !== 'retarget'") &&
        mainLayoutSource.includes("discardActiveRendererCache('enter_retarget_mode')"),
    'MainLayout must discard the main Viewer renderer cache when entering retarget mode'
)

console.log('retarget mode renderer cache cleanup checks ok')
