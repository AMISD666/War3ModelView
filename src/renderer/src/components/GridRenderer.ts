import { mat4 } from 'gl-matrix'

export class GridRenderer {
    private program: WebGLProgram | null = null
    private buffer: WebGLBuffer | null = null
    private count: number = 0

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

        // Create grid vertices
        const size = 1000
        const step = 100
        const vertices: number[] = []

        for (let i = -size; i <= size; i += step) {
            // X lines
            vertices.push(i, -size, 0)
            vertices.push(i, size, 0)
            // Y lines
            vertices.push(-size, i, 0)
            vertices.push(size, i, 0)
        }

        this.count = vertices.length / 3
        this.buffer = gl.createBuffer()
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer)
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW)
    }

    render(gl: WebGLRenderingContext | WebGL2RenderingContext, mvMatrix: mat4, pMatrix: mat4) {
        if (!this.program || !this.buffer) return

        // Save current depth test state
        const depthTestEnabled = gl.isEnabled(gl.DEPTH_TEST)

        // Disable depth test so grid is always rendered behind everything
        gl.disable(gl.DEPTH_TEST)

        gl.useProgram(this.program)

        const uMVP = gl.getUniformLocation(this.program, 'uMVP')
        const uColor = gl.getUniformLocation(this.program, 'uColor')
        const aPosition = gl.getAttribLocation(this.program, 'aPosition')

        const mvp = mat4.create()
        mat4.multiply(mvp, pMatrix, mvMatrix)

        gl.uniformMatrix4fv(uMVP, false, mvp)
        gl.uniform4f(uColor, 0.5, 0.5, 0.5, 0.5) // Grey color

        // Force Alpha Blending state
        gl.enable(gl.BLEND)
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer)
        gl.enableVertexAttribArray(aPosition)
        gl.vertexAttribPointer(aPosition, 3, gl.FLOAT, false, 0, 0)

        gl.drawArrays(gl.LINES, 0, this.count)

        // Clean up WebGL state
        gl.disableVertexAttribArray(aPosition)

        // Restore depth test state
        if (depthTestEnabled) {
            gl.enable(gl.DEPTH_TEST)
        }
    }

    private compileShader(gl: WebGLRenderingContext | WebGL2RenderingContext, type: number, source: string) {
        const shader = gl.createShader(type)
        if (!shader) return null
        gl.shaderSource(shader, source)
        gl.compileShader(shader)
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error('Shader compile error:', gl.getShaderInfoLog(shader))
            gl.deleteShader(shader)
            return null
        }
        return shader
    }
}
