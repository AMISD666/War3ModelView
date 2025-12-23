import { mat4 } from 'gl-matrix'
import { GridSettings } from '../store/rendererStore'

export class GridRenderer {
    private program: WebGLProgram | null = null

    // Separate buffers for independent layers
    private buffer128: WebGLBuffer | null = null
    private count128: number = 0

    private buffer512: WebGLBuffer | null = null
    private count512: number = 0

    private buffer1024: WebGLBuffer | null = null
    private count1024: number = 0

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
        if (this.buffer128) gl.deleteBuffer(this.buffer128)
        if (this.buffer512) gl.deleteBuffer(this.buffer512)
        if (this.buffer1024) gl.deleteBuffer(this.buffer1024)

        this.createBuffer(gl, size, 128, '128')
        this.createBuffer(gl, size, 512, '512')
        this.createBuffer(gl, size, 1024, '1024')
    }

    private createBuffer(gl: WebGLRenderingContext | WebGL2RenderingContext, size: number, step: number, type: '128' | '512' | '1024') {
        const vertices: number[] = []

        // Generate lines
        for (let i = -size; i <= size; i += step) {
            // X lines (vertical lines moving along X)
            vertices.push(i, -size, 0)
            vertices.push(i, size, 0)

            // Y lines (horizontal lines moving along Y)
            vertices.push(-size, i, 0)
            vertices.push(size, i, 0)
        }

        const buffer = gl.createBuffer()
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW)

        const count = vertices.length / 3

        if (type === '128') {
            this.buffer128 = buffer
            this.count128 = count
        } else if (type === '512') {
            this.buffer512 = buffer
            this.count512 = count
        } else {
            this.buffer1024 = buffer
            this.count1024 = count
        }
    }

    render(gl: WebGLRenderingContext | WebGL2RenderingContext, mvMatrix: mat4, pMatrix: mat4, settings: GridSettings) {
        if (!this.program) return
        if (!settings) return
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

        const drawLayer = (buffer: WebGLBuffer | null, count: number, color: number[]) => {
            if (!buffer || count === 0) return
            gl.uniform4f(uColor, color[0], color[1], color[2], color[3])
            gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
            gl.enableVertexAttribArray(aPosition)
            gl.vertexAttribPointer(aPosition, 3, gl.FLOAT, false, 0, 0)
            gl.drawArrays(gl.LINES, 0, count)
        }

        // Draw layers order: 128 (White) -> 512 (Yellow) -> 1024 (Red)
        // Drawing smaller first ensures larger grids overlay cleanly
        if (settings.show128) {
            drawLayer(this.buffer128, this.count128, [1.0, 1.0, 1.0, 0.3]) // White with transparency
        }
        if (settings.show512) {
            drawLayer(this.buffer512, this.count512, [1.0, 1.0, 0.0, 0.5]) // Yellow
        }
        if (settings.show1024) {
            drawLayer(this.buffer1024, this.count1024, [1.0, 0.0, 0.0, 0.6]) // Red
        }

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
