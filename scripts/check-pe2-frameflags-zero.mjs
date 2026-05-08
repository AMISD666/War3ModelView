import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'

const repoRoot = resolve(import.meta.dirname, '..')
const particlesPath = resolve(repoRoot, 'vendor/war3-model/renderer/particles.ts')
const source = readFileSync(particlesPath, 'utf8')
const ast = ts.createSourceFile(particlesPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)

const fail = (message) => {
    console.error(`[check-pe2-frameflags-zero] ${message}`)
    process.exit(1)
}

if (/FrameFlags\s*\|\|\s*1/.test(source)) {
    fail('FrameFlags uses || 1 fallback, which incorrectly turns explicit 0 into Head.')
}

if (!source.includes('function getParticleEmitter2FrameFlags')) {
    fail('Missing centralized ParticleEmitter2 FrameFlags helper.')
}

const hasTopLevelHelper = ast.statements.some((statement) =>
    ts.isFunctionDeclaration(statement) &&
    statement.name?.text === 'getParticleEmitter2FrameFlags'
)
if (!hasTopLevelHelper) {
    fail('FrameFlags helper must be declared at module top level so ParticlesController can call it.')
}

if (!/props\.FrameFlags\s*==\s*null\s*\?\s*ParticleEmitter2FramesFlags\.Head/.test(source)) {
    fail('FrameFlags helper must default only null/undefined to Head.')
}

const helperUseCount = (source.match(/getParticleEmitter2FrameFlags\(/g) ?? []).length
if (helperUseCount < 4) {
    fail('FrameFlags helper must be used by constructor and syncEmitters paths.')
}

console.log('[check-pe2-frameflags-zero] ok')
