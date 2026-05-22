import fs from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()
const hookPath = path.join(repoRoot, 'src', 'renderer', 'src', 'hooks', 'useNodeEditorPreview.ts')
const source = fs.readFileSync(hookPath, 'utf8')

if (source.includes('!currentNodeObjectId')) {
    throw new Error('useNodeEditorPreview must not reject ObjectId=0 as a missing node')
}

if (!source.includes('currentNodeObjectId == null')) {
    throw new Error('useNodeEditorPreview should only reject null/undefined currentNodeObjectId')
}

console.log('node preview ObjectId=0 check passed')
