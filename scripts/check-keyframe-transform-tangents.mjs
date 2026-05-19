import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const commandSource = readFileSync(join(root, 'src/renderer/src/commands/UpdateKeyframeCommand.ts'), 'utf8')
const viewerSource = readFileSync(join(root, 'src/renderer/src/components/viewer/ViewerImpl.tsx'), 'utf8')

function assert(condition, message) {
  if (!condition) {
    console.error(`[check-keyframe-transform-tangents] ${message}`)
    process.exit(1)
  }
}

assert(
  /function ensureKeyTangents[\s\S]*LINE_TYPE_HERMITE[\s\S]*LINE_TYPE_BEZIER[\s\S]*InTan:[\s\S]*OutTan:/.test(commandSource),
  'UpdateKeyframeCommand must fill InTan/OutTan for Hermite and Bezier transform keyframes.'
)

assert(
  /prop\.Keys = prop\.Keys\.map\(\(key\) => ensureKeyTangents\(key, change\.propertyName, lineType\)\)/.test(commandSource),
  'UpdateKeyframeCommand must normalize all keys on the edited Hermite/Bezier track before renderer update.'
)

assert(
  /LineType: lineType,[\s\S]*InterpolationType: lineType/.test(commandSource),
  'UpdateKeyframeCommand must keep LineType and InterpolationType synchronized.'
)

assert(
  /const getPreviewKeyTangents =[\s\S]*lineType === 2 \|\| lineType === 3[\s\S]*InTan:[\s\S]*OutTan:/.test(viewerSource),
  'Viewer keyframe drag preview must create tangents for Hermite/Bezier preview keys.'
)

assert(
  /Object\.assign\(translationKeys\[tempKeyIndex\], previewTangents\)/.test(viewerSource) &&
    /Object\.assign\(keys\[previewIndex\], previewTangents\)/.test(viewerSource),
  'Viewer keyframe drag preview must refresh tangents when reusing preview keys.'
)

console.log('[check-keyframe-transform-tangents] ok')
