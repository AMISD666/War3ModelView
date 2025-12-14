import { mat4, vec3, vec4 } from 'gl-matrix'

/**
 * AxisIndicator - Renders a small 3D coordinate axis indicator in the corner of the viewport
 * X: Red (+X), Y: Green (+Y), Z: Blue (+Z)
 * Returns screen positions for labels to be rendered by React
 */

export interface AxisLabelPosition {
    label: string
    x: number
    y: number
    color: string
}

export class AxisIndicator {
    private shaderProgram: WebGLProgram | null = null
    private positionBuffer: WebGLBuffer | null = null
    private colorBuffer: WebGLBuffer | null = null
    private initialized = false

    // Last computed label positions for React overlay
    public labelPositions: AxisLabelPosition[] = []

    private readonly AXIS_LENGTH = 1.0
    private readonly ARROW_SIZE = 0.15

    // Axis vertices: origin to X, origin to Y, origin to Z
    // Plus arrow heads for each axis
    private vertices: Float32Array

    // Colors: R, G, B for each axis (including arrows)
    private colors: Float32Array

    constructor() {
        const L = this.AXIS_LENGTH
        const A = this.ARROW_SIZE

        // Build vertices: 3 main lines + 3 arrow heads (each arrow = 2 lines)
        this.vertices = new Float32Array([
            // X axis main line
            0, 0, 0, L, 0, 0,
            // X arrow head (two lines)
            L, 0, 0, L - A, A * 0.5, 0,
            L, 0, 0, L - A, -A * 0.5, 0,

            // Y axis main line
            0, 0, 0, 0, L, 0,
            // Y arrow head (two lines)
            0, L, 0, A * 0.5, L - A, 0,
            0, L, 0, -A * 0.5, L - A, 0,

            // Z axis main line
            0, 0, 0, 0, 0, L,
            // Z arrow head (two lines)
            0, 0, L, A * 0.5, 0, L - A,
            0, 0, L, -A * 0.5, 0, L - A
        ])

        // Colors for each vertex pair
        this.colors = new Float32Array([
            // X axis - Red (main + 2 arrow lines = 3 lines * 2 vertices * 4 color components)
            1, 0, 0, 1, 1, 0, 0, 1,
            1, 0, 0, 1, 1, 0, 0, 1,
            1, 0, 0, 1, 1, 0, 0, 1,

            // Y axis - Green
            0, 1, 0, 1, 0, 1, 0, 1,
            0, 1, 0, 1, 0, 1, 0, 1,
            0, 1, 0, 1, 0, 1, 0, 1,

            // Z axis - Blue
            0, 0, 1, 1, 0, 0, 1, 1,
            0, 0, 1, 1, 0, 0, 1, 1,
            0, 0, 1, 1, 0, 0, 1, 1
        ])
    }

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
     * Project a 3D point to screen coordinates
     */
    private projectToScreen(
        point: vec3,
        mvMatrix: mat4,
        pMatrix: mat4,
        viewportX: number,
        viewportY: number,
        viewportW: number,
        viewportH: number
    ): { x: number; y: number } {
        const mvp = mat4.create()
        mat4.multiply(mvp, pMatrix, mvMatrix)

        const clipPos = vec4.fromValues(point[0], point[1], point[2], 1)
        vec4.transformMat4(clipPos, clipPos, mvp)

        // Perspective divide
        const ndcX = clipPos[0] / clipPos[3]
        const ndcY = clipPos[1] / clipPos[3]

        // Convert to screen coordinates
        const screenX = viewportX + (ndcX + 1) * 0.5 * viewportW
        const screenY = viewportY + (1 - ndcY) * 0.5 * viewportH // Flip Y

        return { x: screenX, y: screenY }
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

        // Set up a larger viewport in bottom-left corner
        const indicatorSize = 300
        const margin = 5
        const vpX = margin
        const vpY = margin
        gl.viewport(vpX, vpY, indicatorSize, indicatorSize)

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

        // Move camera back slightly and shift down to verify visually
        const mvMatrix = mat4.create()
        // Shift Y down by 0.6 units to lower the axis origin in the viewport
        mat4.translate(mvMatrix, mvMatrix, [0, -0.6, -3])
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

        // Draw XYZ axis lines with arrows (3 lines per axis = 18 vertices total)
        gl.lineWidth(2.0)
        gl.drawArrays(gl.LINES, 0, 18)

        // Clean up
        gl.disableVertexAttribArray(positionLoc)
        gl.disableVertexAttribArray(colorLoc)

        // Calculate label screen positions
        // Offset labels slightly beyond arrow tips
        const labelOffset = this.AXIS_LENGTH + 0.3
        const xTip = vec3.fromValues(labelOffset, 0, 0)
        const yTip = vec3.fromValues(0, labelOffset, 0)
        const zTip = vec3.fromValues(0, 0, labelOffset)

        // Convert indicator viewport coordinates to canvas coordinates
        // Indicator is at bottom-left, need to add vpY and flip for canvas (top-left origin)
        const toCanvasY = (vpScreenY: number) => canvasHeight - vpScreenY

        const xScreen = this.projectToScreen(xTip, mvMatrix, pMatrix, vpX, vpY, indicatorSize, indicatorSize)
        const yScreen = this.projectToScreen(yTip, mvMatrix, pMatrix, vpX, vpY, indicatorSize, indicatorSize)
        const zScreen = this.projectToScreen(zTip, mvMatrix, pMatrix, vpX, vpY, indicatorSize, indicatorSize)

        this.labelPositions = [
            { label: '+X', x: xScreen.x, y: toCanvasY(xScreen.y), color: '#ff4444' },
            { label: '+Y', x: yScreen.x, y: toCanvasY(yScreen.y), color: '#44ff44' },
            { label: '+Z', x: zScreen.x, y: toCanvasY(zScreen.y), color: '#4488ff' }
        ]

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
