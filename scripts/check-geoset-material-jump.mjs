import { readFileSync } from 'node:fs'

const file = 'src/renderer/src/components/GeosetVisibilityPanel.tsx'
const text = readFileSync(file, 'utf8')

const checks = [
  {
    needle: 'const materialId = Number(modelData?.Geosets?.[targetIndex]?.MaterialID);',
    message: 'jump action derives the target material from the clicked geoset',
  },
  {
    needle: 'selectionState.setSelectedMaterialIndex(materialId);',
    message: 'jump action updates the material-manager primary selection',
  },
  {
    needle: 'selectionState.setSelectedMaterialIndices([materialId]);',
    message: 'jump action updates multi-material selection consistently',
  },
  {
    needle: 'selectionState.setSelectedMaterialLayerIndex(0);',
    message: 'jump action opens the first layer of the target material',
  },
  {
    needle: "appMessage.warning('当前多边形没有有效材质');",
    message: 'jump action rejects invalid material ids instead of falling back to material 0',
  },
]

let failed = false
for (const check of checks) {
  const ok = text.includes(check.needle)
  console.log(`${ok ? 'ok' : 'missing'} - ${check.message}`)
  failed ||= !ok
}

if (failed) {
  process.exit(1)
}
