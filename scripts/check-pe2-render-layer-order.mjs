import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '..')
const modelRenderer = readFileSync(resolve(repoRoot, 'vendor/war3-model/renderer/modelRenderer.ts'), 'utf8')
const particles = readFileSync(resolve(repoRoot, 'vendor/war3-model/renderer/particles.ts'), 'utf8')

const fail = (message) => {
    console.error(`[check-pe2-render-layer-order] ${message}`)
    process.exit(1)
}

if (!particles.includes('export interface ParticleEmitter2RenderItem')) {
    fail('ParticlesController must expose PE2 render items for renderer-level sorting.')
}

if (!particles.includes('public getRenderItems(cameraPos: vec3 | null): ParticleEmitter2RenderItem[]')) {
    fail('ParticlesController must provide getRenderItems().')
}

if (!particles.includes('public renderEmitterByIndex(emitterIndex: number, mvMatrix: mat4, pMatrix: mat4): void')) {
    fail('ParticlesController must allow drawing one emitter after sorting.')
}

if (!particles.includes("export type ParticleQualityMode = 'full' | 'game'")) {
    fail('ParticlesController must expose the full/game particle quality mode type.')
}

if (!particles.includes('const GAME_PARTICLE_EMISSION_SCALE = 0.22;')) {
    fail('Game particle quality must use the agreed 0.22 emission scale.')
}

if (!particles.includes('public setParticleQualityMode(mode: ParticleQualityMode): void')) {
    fail('ParticlesController must allow switching particle quality at runtime.')
}

if (!particles.includes('this.thinEmitterParticles(emitter, nextScale / previousScale)')) {
    fail('Switching down to game quality must immediately thin existing particles.')
}

if (!particles.includes('emissionRate * this.getEmissionScale() * delta')) {
    fail('Game particle quality must scale continuous emission rate.')
}

if (!modelRenderer.includes("kind: 'particle2'")) {
    fail('modelRenderer must add ParticleEmitter2 entries into the transparent render queue.')
}

if (!modelRenderer.includes('mapParticleEmitter2FilterMode(item.filterMode)')) {
    fail('ParticleEmitter2 filter modes must be mapped to material-style sort modes.')
}

if (!modelRenderer.includes('getWar3FilterDrawRank(a.filterMode)') ||
    !modelRenderer.includes('getWar3FilterDrawRank(b.filterMode)')) {
    fail('Transparent render queue must use material-style filter priority, not raw enum order.')
}

if (!modelRenderer.includes('instance.particlesController.renderEmitterByIndex(entry.emitterIndex, instanceMV, pMatrix)')) {
    fail('modelRenderer must render sorted ParticleEmitter2 entries individually.')
}

if (!modelRenderer.includes('public setParticleQualityMode(mode: ParticleQualityMode): void')) {
    fail('ModelRenderer must expose setParticleQualityMode().')
}

const finalWholeBatchIndex = modelRenderer.indexOf('instance.particlesController.render(instanceMV, pMatrix);')
const finalHdGuardIndex = modelRenderer.lastIndexOf('if (this.isHD)', finalWholeBatchIndex)
const finalSdGuardIndex = modelRenderer.lastIndexOf('if (!this.isHD)', finalWholeBatchIndex)
if (finalWholeBatchIndex >= 0 && (finalHdGuardIndex < 0 || finalSdGuardIndex > finalHdGuardIndex)) {
    fail('SD ParticleEmitter2 rendering must not remain as an unsorted final whole-batch pass.')
}

if (!particles.includes('getParticleEmitter2PhaseTime(emitter.props)')) {
    fail('ParticleEmitter2 Time must use the source value instead of defaulting valid boundary values to 0.5.')
}

if (/Math\.abs\(firstScale\)\s*<\s*0\.01/.test(particles) || /Math\.abs\(secondScale\)\s*<\s*0\.01/.test(particles)) {
    fail('ParticleScaling values near zero must not be forcibly replaced with default scale.')
}

if (particles.includes('vec3.cross(tailCross, particle.speed, this.rendererData.cameraPos)')) {
    fail('Tail orientation must use the particle-to-camera view direction, not absolute camera position.')
}

if (!particles.includes('vec3.cross(tailCross, tailWorldSpeed, tailViewDir)')) {
    fail('Tail orientation must be based on world speed and particle-to-camera view direction.')
}

console.log('[check-pe2-render-layer-order] ok')
