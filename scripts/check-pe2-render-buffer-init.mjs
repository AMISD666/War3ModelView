import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const source = fs.readFileSync(path.join(process.cwd(), 'vendor/war3-model/renderer/particles.ts'), 'utf8')

function fail(message) {
    console.error(`[check-pe2-render-buffer-init] ${message}`)
    process.exit(1)
}

if (!source.includes('private ensureEmitterRenderBuffers(emitter: ParticleEmitterWrapper): void')) {
    fail('Missing centralized render buffer initializer.')
}

if (!source.includes('private hasEmitterGLRenderBuffers(emitter: ParticleEmitterWrapper): boolean')) {
    fail('Missing WebGL render buffer completeness guard.')
}

if (!source.includes('private hasEmitterGPURenderBuffers(emitter: ParticleEmitterWrapper): boolean')) {
    fail('Missing WebGPU render buffer completeness guard.')
}

if (!source.includes('private disableAllVertexAttribArrays(): void')) {
    fail('Missing WebGL vertex attribute state reset helper.')
}

if (!source.includes('private enableParticleVertexAttribArrays(): boolean')) {
    fail('Missing particle-only vertex attribute enable helper.')
}

if (!/if \(size <= emitter\.capacity\) \{\s*this\.ensureEmitterRenderBuffers\(emitter\);\s*return;\s*\}/.test(source)) {
    fail('resizeEmitterBuffers must ensure GL/GPU buffers before returning when typed-array capacity is already sufficient.')
}

if (!/this\.ensureEmitterRenderBuffers\(emitter\);\s*if \(!this\.hasEmitterGLRenderBuffers\(emitter\)\) \{\s*continue;\s*\}/.test(source)) {
    fail('WebGL render path must ensure and verify emitter buffers before drawing.')
}

if (!/this\.ensureEmitterRenderBuffers\(emitter\);\s*if \(!this\.hasEmitterGLRenderBuffers\(emitter\)\) \{\s*return;\s*\}/.test(source)) {
    fail('WebGL per-emitter render path must ensure and verify emitter buffers before drawing.')
}

if (!/this\.ensureEmitterRenderBuffers\(emitter\);\s*if \(!this\.hasEmitterGPURenderBuffers\(emitter\)\) \{\s*continue;\s*\}/.test(source)) {
    fail('WebGPU render path must ensure and verify emitter buffers before drawing.')
}

if (!/const maxAttribs = this\.gl\.getParameter\(this\.gl\.MAX_VERTEX_ATTRIBS\) as number;\s*for \(let i = 0; i < maxAttribs; \+\+i\) \{\s*this\.gl\.disableVertexAttribArray\(i\);/.test(source)) {
    fail('Particle render path must clear stale enabled vertex attributes left by previous passes.')
}

if (!/if \(!this\.enableParticleVertexAttribArrays\(\)\) \{\s*return;\s*\}/.test(source)) {
    fail('Particle render path must explicitly enable only its own vertex attributes.')
}

for (const expected of [
    'emitter.headVertexBuffer = this.gl.createBuffer()',
    'emitter.headTexCoordBuffer = this.gl.createBuffer()',
    'emitter.tailVertexBuffer = this.gl.createBuffer()',
    'emitter.tailTexCoordBuffer = this.gl.createBuffer()',
    'emitter.colorBuffer = this.gl.createBuffer()',
    'emitter.indexBuffer = this.gl.createBuffer()'
]) {
    if (!source.includes(expected)) {
        fail(`Missing WebGL buffer initialization: ${expected}`)
    }
}

console.log('[check-pe2-render-buffer-init] ok')
