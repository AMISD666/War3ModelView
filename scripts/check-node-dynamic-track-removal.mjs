import { readFileSync } from 'node:fs'

const checks = [
  {
    file: 'src/renderer/src/components/node/NodeDialog.tsx',
    needle: 'else delete (nextNode as any).Translation',
    message: 'Node dialog deletes Translation when dynamic movement is unchecked',
  },
  {
    file: 'src/renderer/src/components/node/NodeDialog.tsx',
    needle: 'else delete (nextNode as any).Rotation',
    message: 'Node dialog deletes Rotation when dynamic rotation is unchecked',
  },
  {
    file: 'src/renderer/src/components/node/NodeDialog.tsx',
    needle: 'else delete (nextNode as any).Scaling',
    message: 'Node dialog deletes Scaling when dynamic scale is unchecked',
  },
  {
    file: 'src/renderer/src/components/node/NodeDialog.tsx',
    needle: 'clearMissingAnimationTracks?: boolean',
    message: 'Node dialog can mark missing animation tracks for explicit clearing',
  },
  {
    file: 'src/renderer/src/components/node/NodeDialog.tsx',
    needle: 'else if (clearMissingAnimationTracks) (nextNode as any).Rotation = null',
    message: 'Node dialog submits null for Rotation when saving an unchecked dynamic rotation',
  },
  {
    file: 'src/renderer/src/components/node/NodeDialog.tsx',
    needle: 'const updatedNode = buildUpdatedNodeFromValues(values, { clearMissingAnimationTracks: true })',
    message: 'Node dialog save path enables explicit animation-track clearing',
  },
  {
    file: 'src/renderer/src/store/modelStore.ts',
    needle: "const mergeNodeUpdates = (node: ModelNode, updates: Partial<ModelNode>): ModelNode => {",
    message: 'model store centralizes node update merge semantics',
  },
  {
    file: 'src/renderer/src/store/modelStore.ts',
    needle: "for (const prop of ['Translation', 'Rotation', 'Scaling'] as const) {",
    message: 'model store handles all node transform animation tracks',
  },
  {
    file: 'src/renderer/src/store/modelStore.ts',
    needle: 'delete (merged as any)[prop];',
    message: 'model store removes explicitly cleared transform tracks',
  },
]

const failures = checks.filter(({ file, needle, message }) => {
  const text = readFileSync(file, 'utf8')
  const ok = text.includes(needle)
  console.log(`${ok ? 'ok' : 'missing'} - ${message}`)
  return !ok
})

if (failures.length > 0) {
  process.exit(1)
}
