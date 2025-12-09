import { mat4, vec3 } from 'gl-matrix'

/**
 * AxisIndicator - Renders a small 3D coordinate axis indicator in the corner of the viewport
 * X: Red, Y: Green, Z: Blue
 */
export class AxisIndicator {
    private shaderProgram: WebGLProgram | null = null
    private positionBuffer: WebGLBuffer | null = null
    private colorBuffer: WebGLBuffer | null = null
    private initialized = false

    private readonly AXIS_LENGTH = 1.0

    // Axis vertices: origin to X, origin to Y, origin to Z
    private vertices = new Float32Array([
        // X axis
        0, 0, 0, this.AXIS_LENGTH, 0, 0,
        // Y axis
        0, 0, 0, 0, this.AXIS_LENGTH, 0,
        // Z axis
        0, 0, 0, 0, 0, this.AXIS_LENGTH
    ])

    // Colors: R, G, B for each axis
    private colors = new Float32Array([
        // X axis - Red
        1, 0, 0, 1, 1, 0, 0, 1,
        // Y axis - Green
        0, 1, 0, 1, 0, 1, 0, 1,
        // Z axis - Blue
        0, 0, 1, 1, 0, 0, 1, 1
    ])

    private vertexShaderSource = `
    attribute vec3 aPosition;
    attribute vec4 aColor;
    uniform mat4 uMVMatrix;
    uniform mat4 uPMatrix;
    varying vec4 vColor;
    void main() {
      gl_Position = uPMatrix * uMVMatrix * vec4(aPosition, 1.0);
      vColor = aColor;
    }
  `

    private fragmentShaderSource = `
    precision mediump float;
    varying vec4 vColor;
    void main() {
      gl_FragColor = vColor;
    }
  `

    private createShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
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

    private init(gl: WebGLRenderingContext): boolean {
        if (this.initialized) return true

        const vs = this.createShader(gl, gl.VERTEX_SHADER, this.vertexShaderSource)
        const fs = this.createShader(gl, gl.FRAGMENT_SHADER, this.fragmentShaderSource)
        if (!vs || !fs) return false

        this.shaderProgram = gl.createProgram()
        if (!this.shaderProgram) return false

        gl.attachShader(this.shaderProgram, vs)
        gl.attachShader(this.shaderProgram, fs)
        gl.linkProgram(this.shaderProgram)

        if (!gl.getProgramParameter(this.shaderProgram, gl.LINK_STATUS)) {
            console.error('Program link error:', gl.getProgramInfoLog(this.shaderProgram))
            return false
        }

        this.positionBuffer = gl.createBuffer()
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer)
        gl.bufferData(gl.ARRAY_BUFFER, this.vertices, gl.STATIC_DRAW)

        this.colorBuffer = gl.createBuffer()
        gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer)
        gl.bufferData(gl.ARRAY_BUFFER, this.colors, gl.STATIC_DRAW)

        this.initialized = true
        return true
    }

    /**
     * Render the axis indicator in the bottom-left corner
     * @param gl WebGL context
     * @param viewMatrix The current view matrix (used to extract rotation only)
     * @param canvasWidth Canvas width
     * @param canvasHeight Canvas height
     */
    render(gl: WebGLRenderingContext, viewMatrix: mat4, canvasWidth: number, canvasHeight: number): void {
        if (!this.init(gl) || !this.shaderProgram) return

        // Save current viewport and state
        const currentViewport = gl.getParameter(gl.VIEWPORT) as Int32Array

        // Set up a larger viewport in bottom-left corner (150x150 pixels)
        const indicatorSize = 150
        const margin = 15
        gl.viewport(margin, margin, indicatorSize, indicatorSize)

        // Disable depth test for overlay rendering
        gl.disable(gl.DEPTH_TEST)

        // Extract rotation from view matrix (remove translation)
        const rotationMatrix = mat4.clone(viewMatrix)
        // Zero out translation components
        rotationMatrix[12] = 0
        rotationMatrix[13] = 0
        rotationMatrix[14] = 0

        // Create a simple orthographic projection for indicator
        const pMatrix = mat4.create()
        mat4.ortho(pMatrix, -2, 2, -2, 2, -10, 10)

        // Move camera back slightly
        const mvMatrix = mat4.create()
        mat4.translate(mvMatrix, mvMatrix, [0, 0, -3])
        mat4.multiply(mvMatrix, mvMatrix, rotationMatrix)

        gl.useProgram(this.shaderProgram)

        const positionLoc = gl.getAttribLocation(this.shaderProgram, 'aPosition')
        const colorLoc = gl.getAttribLocation(this.shaderProgram, 'aColor')
        const mvMatrixLoc = gl.getUniformLocation(this.shaderProgram, 'uMVMatrix')
        const pMatrixLoc = gl.getUniformLocation(this.shaderProgram, 'uPMatrix')

        gl.uniformMatrix4fv(mvMatrixLoc, false, mvMatrix)
        gl.uniformMatrix4fv(pMatrixLoc, false, pMatrix)

        // Bind position
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer)
        gl.enableVertexAttribArray(positionLoc)
        gl.vertexAttribPointer(positionLoc, 3, gl.FLOAT, false, 0, 0)

        // Bind colors
        gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer)
        gl.enableVertexAttribArray(colorLoc)
        gl.vertexAttribPointer(colorLoc, 4, gl.FLOAT, false, 0, 0)

        // Draw XYZ axis lines (2 vertices each, 3 axes)
        gl.lineWidth(3.0)
        gl.drawArrays(gl.LINES, 0, 6)

        // Clean up
        gl.disableVertexAttribArray(positionLoc)
        gl.disableVertexAttribArray(colorLoc)

        // Restore viewport and state
        gl.viewport(currentViewport[0], currentViewport[1], currentViewport[2], currentViewport[3])
        gl.enable(gl.DEPTH_TEST)
    }

    destroy(gl: WebGLRenderingContext): void {
        if (this.positionBuffer) gl.deleteBuffer(this.positionBuffer)
        if (this.colorBuffer) gl.deleteBuffer(this.colorBuffer)
        if (this.shaderProgram) gl.deleteProgram(this.shaderProgram)
        this.initialized = false
    }
}
