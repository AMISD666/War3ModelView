import { readFileSync } from 'node:fs'

const file = 'src/renderer/src/components/viewer/ViewerImpl.tsx'
const text = readFileSync(file, 'utf8')

const checks = [
  {
    needle: 'const hitTestGizmoAxis = (clientX: number, clientY: number, center: vec3, transformMode: string | null | undefined): GizmoAxis => {',
    message: 'viewer has a shared gizmo hit-test helper',
  },
  {
    needle: 'const pressedAxis = hitTestGizmoAxis(e.clientX, e.clientY, gizmoInfo.center, transformMode);',
    message: 'mouse down performs a fresh gizmo hit test',
  },
  {
    needle: 'gizmoState.current.activeAxis = pressedAxis;',
    message: 'mouse down updates activeAxis from the fresh hit result',
  },
  {
    needle: 'gizmoState.current.activeAxis = hitTestGizmoAxis(e.clientX, e.clientY, center, transformMode);',
    message: 'hover path uses the same hit-test helper',
  },
]

let failed = false
for (const check of checks) {
  const ok = text.includes(check.needle)
  console.log(`${ok ? 'ok' : 'missing'} - ${check.message}`)
  failed ||= !ok
}

const mouseDownMatch = text.match(/const handleMouseDown = \(e: React\.MouseEvent<HTMLCanvasElement>\) => \{[\s\S]*?\n  const handleBoxSelection =/)
if (!mouseDownMatch) {
  console.log('missing - handleMouseDown block was not found')
  failed = true
} else {
  const mouseDown = mouseDownMatch[0]
  const freshHitIndex = mouseDown.indexOf('const pressedAxis = hitTestGizmoAxis')
  const dragStartIndex = mouseDown.indexOf('gizmoState.current.isDragging = true')
  if (freshHitIndex < 0 || dragStartIndex < 0 || freshHitIndex > dragStartIndex) {
    console.log('unexpected - mouse down does not refresh the gizmo hit before starting drag')
    failed = true
  } else {
    console.log('ok - mouse down refreshes gizmo hit before starting drag')
  }
}

if (failed) {
  process.exit(1)
}
