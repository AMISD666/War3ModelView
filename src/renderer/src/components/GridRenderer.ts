import { mat4 } from 'gl-matrix'
import { GridSettings } from '../store/rendererStore'

export type GridPlane = 'xy' | 'xz' | 'yz'

export class GridRenderer {
    private program: WebGLProgram | null = null

    // Separate buffers for independent layers per plane
    private buffers: { [key: string]: { buffer: WebGLBuffer | null, count: number } } = {}

    private currentSize: number = 0

    init(gl: WebGLRenderingContext | WebGL2RenderingContext) {
        const vsSource = `
            attribute vec3 aPosition;
            uniform mat4 uMVP;
            void main() {
                gl_Position = uMVP * vec4(aPosition, 1.0);
            }
        `
        const fsSource = `
            precision mediump float;
            uniform vec4 uColor;
            void main() {
                gl_FragColor = uColor;
            }
        `

        const vs = this.compileShader(gl, gl.VERTEX_SHADER, vsSource)
        const fs = this.compileShader(gl, gl.FRAGMENT_SHADER, fsSource)
        if (!vs || !fs) return

        this.program = gl.createProgram()
        if (!this.program) return
        gl.attachShader(this.program, vs)
        gl.attachShader(this.program, fs)
        gl.linkProgram(this.program)

        if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
            console.error('Grid shader link error:', gl.getProgramInfoLog(this.program))
            return
        }

        // Initial buffer creation (default 2048, but will be updated by render if needed)
        this.updateBuffers(gl, 2048)
    }

    updateBuffers(gl: WebGLRenderingContext | WebGL2RenderingContext, size: number) {
        if (size === this.currentSize) return
        this.currentSize = size

        // Delete old buffers
        Object.values(this.buffers).forEach(b => {
            if (b.buffer) gl.deleteBuffer(b.buffer)
        })
        this.buffers = {}

        // Create buffers for all planes and grid sizes
        const planes: GridPlane[] = ['xy', 'xz', 'yz']
        const steps = [128, 512, 1024]

        planes.forEach(plane => {
            steps.forEach(step => {
                this.createBuffer(gl, size, step, plane)
            })
        })
    }

    private createBuffer(gl: WebGLRenderingContext | WebGL2RenderingContext, size: number, step: number, plane: GridPlane) {
        const vertices: number[] = []

        // Generate lines based on plane
        for (let i = -size; i <= size; i += step) {
            if (plane === 'xy') {
                // XY plane (z = 0)
                vertices.push(i, -size, 0)
                vertices.push(i, size, 0)
                vertices.push(-size, i, 0)
                vertices.push(size, i, 0)
            } else if (plane === 'xz') {
                // XZ plane (y = 0)
                vertices.push(i, 0, -size)
                vertices.push(i, 0, size)
                vertices.push(-size, 0, i)
                vertices.push(size, 0, i)
            } else {
                // YZ plane (x = 0)
                vertices.push(0, i, -size)
                vertices.push(0, i, size)
                vertices.push(0, -size, i)
                vertices.push(0, size, i)
            }
        }

        const buffer = gl.createBuffer()
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW)

        const key = `${plane}_${step}`
        this.buffers[key] = { buffer, count: vertices.length / 3 }
    }

    render(
        gl: WebGLRenderingContext | WebGL2RenderingContext,
        mvMatrix: mat4,
        pMatrix: mat4,
        settings: GridSettings,
        showXY: boolean,
        showXZ: boolean,
        showYZ: boolean
    ) {
        if (!this.program) return
        if (!settings) return
        if (!showXY && !showXZ && !showYZ) return

        if (settings.enableDepth) {
            gl.enable(gl.DEPTH_TEST)
            gl.depthMask(true)
        } else {
            gl.disable(gl.DEPTH_TEST)
            gl.depthMask(false)
        }

        gl.useProgram(this.program)

        const uMVP = gl.getUniformLocation(this.program, 'uMVP')
        const uColor = gl.getUniformLocation(this.program, 'uColor')
        const aPosition = gl.getAttribLocation(this.program, 'aPosition')

        const mvp = mat4.create()
        mat4.multiply(mvp, pMatrix, mvMatrix)
        gl.uniformMatrix4fv(uMVP, false, mvp)

        // Force Alpha Blending state
        gl.enable(gl.BLEND)
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

        const drawLayer = (plane: GridPlane, step: number, color: number[]) => {
            const key = `${plane}_${step}`
            const data = this.buffers[key]
            if (!data || !data.buffer || data.count === 0) return
            gl.uniform4f(uColor, color[0], color[1], color[2], color[3])
            gl.bindBuffer(gl.ARRAY_BUFFER, data.buffer)
            gl.enableVertexAttribArray(aPosition)
            gl.vertexAttribPointer(aPosition, 3, gl.FLOAT, false, 0, 0)
            gl.drawArrays(gl.LINES, 0, data.count)
        }

        const drawPlane = (plane: GridPlane) => {
            // Draw layers order: 128 (White) -> 512 (Yellow) -> 1024 (Red)
            if (settings.show128) {
                drawLayer(plane, 128, [1.0, 1.0, 1.0, 0.3])
            }
            if (settings.show512) {
                drawLayer(plane, 512, [1.0, 1.0, 0.0, 0.5])
            }
            if (settings.show1024) {
                drawLayer(plane, 1024, [1.0, 0.0, 0.0, 0.6])
            }
        }

        // Draw enabled planes
        if (showXY) drawPlane('xy')
        if (showXZ) drawPlane('xz')
        if (showYZ) drawPlane('yz')

        // Clean up WebGL state
        gl.disableVertexAttribArray(aPosition)

        // Restore common state defaults if needed
        gl.enable(gl.DEPTH_TEST)
        gl.depthMask(true)
    }

    private compileShader(gl: WebGLRenderingContext | WebGL2RenderingContext, type: number, source: string) {
        const shader = gl.createShader(type)
        if (!shader) return null
        gl.shaderSource(shader, source)
        gl.compileShader(shader)
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error('Grid shader compile error:', gl.getShaderInfoLog(shader))
            gl.deleteShader(shader)
            return null
        }
        return shader
    }
}
