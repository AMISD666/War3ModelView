import { readFileSync } from 'node:fs'

const file = 'src/renderer/src/components/modals/GeosetAnimationModal.tsx'
const text = readFileSync(file, 'utf8')

const checks = [
  {
    needle: 'const desiredSelectedIndexRef = useRef(-1)',
    message: 'geoset animation manager tracks the user-selected index outside render state',
  },
  {
    needle: 'const selectAnimIndex = (index: number) => {',
    message: 'selection changes flow through a helper that updates the desired index',
  },
  {
    needle: 'const restoreSelectedIndex = (count: number) => {',
    message: 'external GeosetAnim refresh restores the prior selection',
  },
  {
    needle: 'const nextIndex = desiredIndex >= 0 ? Math.min(desiredIndex, count - 1) : 0',
    message: 'refresh clamps the previous selection instead of falling back to the first item',
  },
  {
    needle: 'restoreSelectedIndex(clonedAnims.length)',
    message: 'model/RPC sync uses selection preservation after cloning GeosetAnims',
  },
  {
    needle: 'onClick={() => selectAnimIndex(index)}',
    message: 'list clicks update the preserved desired selection',
  },
]

let failed = false
for (const check of checks) {
  const ok = text.includes(check.needle)
  console.log(`${ok ? 'ok' : 'missing'} - ${check.message}`)
  failed ||= !ok
}

const syncEffectMatch = text.match(/\/\/ Initialize local state[\s\S]*?\n    \}, \[visible,/)
if (!syncEffectMatch) {
  console.log('missing - geoset animation sync effect was not found')
  failed = true
} else if (/setSelectedIndex\(0\)/.test(syncEffectMatch[0])) {
  console.log('unexpected - sync effect still resets selection directly to item 0')
  failed = true
} else {
  console.log('ok - sync effect does not directly reset selection to item 0')
}

if (failed) {
  process.exit(1)
}
