import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '..')
const rendererStore = readFileSync(resolve(repoRoot, 'src/renderer/src/store/rendererStore.ts'), 'utf8')
const menuBar = readFileSync(resolve(repoRoot, 'src/renderer/src/components/MenuBar.tsx'), 'utf8')
const viewer = readFileSync(resolve(repoRoot, 'src/renderer/src/components/viewer/ViewerImpl.tsx'), 'utf8')

const fail = (message) => {
    console.error(`[check-particle-quality-toggle] ${message}`)
    process.exit(1)
}

if (!rendererStore.includes("export type ParticleQualityMode = 'full' | 'game'")) {
    fail('rendererStore must declare ParticleQualityMode.')
}

if (!rendererStore.includes('particleQualityMode: ParticleQualityMode')) {
    fail('rendererStore must store particleQualityMode.')
}

if (!rendererStore.includes('setParticleQualityMode: (mode: ParticleQualityMode) => void')) {
    fail('rendererStore must expose setParticleQualityMode.')
}

if (!rendererStore.includes('renderer?.setParticleQualityMode?.(state.particleQualityMode)')) {
    fail('setRenderer must apply the persisted particle quality to newly assigned renderers.')
}

if (!rendererStore.includes('state.renderer?.setParticleQualityMode?.(mode)')) {
    fail('setParticleQualityMode must apply immediately to the active renderer.')
}

if (!rendererStore.includes('particleQualityMode: state.particleQualityMode')) {
    fail('particleQualityMode must be persisted with renderer settings.')
}

if (!menuBar.includes("key: 'particle-quality'")) {
    fail('MenuBar quick toggles must include the particle quality button.')
}

if (!menuBar.includes("label: '粒子质量'")) {
    fail('Particle quality button must use the requested Chinese label.')
}

if (!menuBar.includes("particleQualityMode === 'full' ? 'game' : 'full'")) {
    fail('Particle quality button must toggle between full and game modes.')
}

if (!menuBar.includes("statusLabel: particleQualityMode === 'full' ? '完整画质' : '游戏画质'")) {
    fail('Particle quality button tooltip must expose full/game states.')
}

if (!viewer.includes('particleQualityModeRef') ||
    !viewer.includes('applyParticleQualityMode(mdlRenderer, particleQualityModeRef.current)')) {
    fail('ViewerImpl must push particle quality mode into the active renderer.')
}

console.log('[check-particle-quality-toggle] ok')
