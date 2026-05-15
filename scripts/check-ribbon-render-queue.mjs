import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseMDX } from 'war3-model'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const fixturePath = path.join(repoRoot, 'testmodel', '7788.mdx')
const modelRendererPath = path.join(repoRoot, 'vendor', 'war3-model', 'renderer', 'modelRenderer.ts')
const ribbonsPath = path.join(repoRoot, 'vendor', 'war3-model', 'renderer', 'ribbons.ts')

const readArrayBuffer = (filePath) => {
  const buffer = fs.readFileSync(filePath)
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
}

const model = parseMDX(readArrayBuffer(fixturePath))
const ribbon = model.RibbonEmitters?.[0]
const material = ribbon ? model.Materials?.[ribbon.MaterialID] : null
const layer = material?.Layers?.[0]
const texture = layer ? model.Textures?.[layer.TextureID]?.Image : null
const geoset = model.Geosets?.[0]

const failures = []

if ((model.RibbonEmitters?.length ?? 0) < 1) {
  failures.push('7788.mdx should contain a RibbonEmitter')
}
if (!ribbon || Number(ribbon.EmissionRate) <= 0 || Number(ribbon.LifeSpan) <= 0) {
  failures.push('7788.mdx ribbon should have positive EmissionRate and LifeSpan')
}
if (!ribbon || Math.abs(Number(ribbon.HeightAbove ?? 0)) + Math.abs(Number(ribbon.HeightBelow ?? 0)) <= 0) {
  failures.push('7788.mdx ribbon should have non-zero height')
}
if (!material || !layer || !texture) {
  failures.push('7788.mdx ribbon material should resolve to a textured layer')
}
if (!geoset || geoset.Vertices?.length !== 3) {
  failures.push('7788.mdx should remain documented as a one-vertex placeholder mesh fixture')
}

const modelRendererSource = fs.readFileSync(modelRendererPath, 'utf8')
const ribbonsSource = fs.readFileSync(ribbonsPath, 'utf8')

if (!modelRendererSource.includes("kind: 'ribbon'")) {
  failures.push('ModelRenderer transparent pass should enqueue ribbon render entries')
}
if (!modelRendererSource.includes('compareTransparentRenderEntries')) {
  failures.push('ModelRenderer should use shared transparent entry ordering for ribbons')
}
if (!ribbonsSource.includes('getRenderItems(cameraPos')) {
  failures.push('RibbonsController should expose transparent render items')
}
if (!ribbonsSource.includes('renderEmitterLayerByIndex')) {
  failures.push('RibbonsController should support per-layer transparent queue rendering')
}
if (!ribbonsSource.includes('setEmitterColorUniform(emitter)')) {
  failures.push('Per-layer ribbon rendering should set the ribbon color/alpha uniform')
}
if (!ribbonsSource.includes('rebuildEmitterHistoryAt')) {
  failures.push('RibbonsController should reconstruct ribbon history from prior animation frames')
}
if (!ribbonsSource.includes('setNodeMatrixRefresh')) {
  failures.push('RibbonsController should be able to refresh node matrices while sampling ribbon history')
}
if (!ribbonsSource.includes('normalizeHistoryFrame')) {
  failures.push('RibbonsController should wrap/clamp historical ribbon frames inside the active sequence')
}

if (failures.length > 0) {
  console.error('[check-ribbon-render-queue] failed')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log('[check-ribbon-render-queue] ok', {
  ribbonCount: model.RibbonEmitters.length,
  texture,
  filterMode: layer.FilterMode,
  placeholderVertices: geoset.Vertices.length / 3,
})
