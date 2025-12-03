import { mat4, vec3 } from 'gl-matrix'

const vsSource = `
  attribute vec3 aPosition;
  uniform mat4 uMVMatrix;
  uniform mat4 uPMatrix;
  uniform float uPointSize;
  void main() {
    gl_Position = uPMatrix * uMVMatrix * vec4(aPosition, 1.0);
    gl_PointSize = uPointSize;
  }
`

const fsSource = `
  precision mediump float;
  uniform vec4 uColor;
  void main() {
    gl_FragColor = uColor;
  }
`

interface NodeWrapper {
    node: {
        ObjectId: number
        Parent?: number | null
        PivotPoint: Float32Array
    }
    matrix: Float32Array
}

export class DebugRenderer {
    private program: WebGLProgram | null = null
    private aPosition: number = -1
    private uMVMatrix: WebGLUniformLocation | null = null
    private uPMatrix: WebGLUniformLocation | null = null
    private uColor: WebGLUniformLocation | null = null
    private uPointSize: WebGLUniformLocation | null = null
    private buffer: WebGLBuffer | null = null

    init(gl: WebGLRenderingContext | WebGL2RenderingContext) {
        const vs = this.compileShader(gl, gl.VERTEX_SHADER, vsSource)
        const fs = this.compileShader(gl, gl.FRAGMENT_SHADER, fsSource)
        if (!vs || !fs) return

        this.program = gl.createProgram()
        if (!this.program) return

        gl.attachShader(this.program, vs)
        gl.attachShader(this.program, fs)
        gl.linkProgram(this.program)

        if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
            console.error('DebugRenderer shader link error:', gl.getProgramInfoLog(this.program))
            return
        }

        this.aPosition = gl.getAttribLocation(this.program, 'aPosition')
        this.uMVMatrix = gl.getUniformLocation(this.program, 'uMVMatrix')
        this.uPMatrix = gl.getUniformLocation(this.program, 'uPMatrix')
        this.uColor = gl.getUniformLocation(this.program, 'uColor')
        this.uPointSize = gl.getUniformLocation(this.program, 'uPointSize')

        this.buffer = gl.createBuffer()
    }

    private compileShader(gl: WebGLRenderingContext | WebGL2RenderingContext, type: number, source: string) {
        const shader = gl.createShader(type)
        if (!shader) return null
        gl.shaderSource(shader, source)
        gl.compileShader(shader)
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error('DebugRenderer shader compile error:', gl.getShaderInfoLog(shader))
            gl.deleteShader(shader)
            return null
        }
        return shader
    }

    renderNodes(
        gl: WebGLRenderingContext | WebGL2RenderingContext,
        mvMatrix: mat4,
        pMatrix: mat4,
        nodes: NodeWrapper[],
        selectedNodeIds: number[] = [],
        parentOfSelected: number | null = null,
        childrenOfSelected: number[] = []
    ) {
        if (!this.program || !this.buffer) return

        const defaultPositions: number[] = []
        const selectedPositions: number[] = []
        const parentPositions: number[] = []
        const childrenPositions: number[] = []

        const tempPos = vec3.create()

        for (const node of nodes) {
            if (node.node.PivotPoint) {
                vec3.transformMat4(tempPos, node.node.PivotPoint, node.matrix)

                if (selectedNodeIds.includes(node.node.ObjectId)) {
                    selectedPositions.push(tempPos[0], tempPos[1], tempPos[2])
                } else if (node.node.ObjectId === parentOfSelected) {
                    parentPositions.push(tempPos[0], tempPos[1], tempPos[2])
                } else if (childrenOfSelected.includes(node.node.ObjectId)) {
                    childrenPositions.push(tempPos[0], tempPos[1], tempPos[2])
                } else {
                    defaultPositions.push(tempPos[0], tempPos[1], tempPos[2])
                }
            }
        }

        // Render Default (Green)
        if (defaultPositions.length > 0) {
            this.draw(gl, mvMatrix, pMatrix, defaultPositions, [0, 1, 0, 1], gl.POINTS, 6.0)
        }

        // Render Children (Yellow)
        if (childrenPositions.length > 0) {
            this.draw(gl, mvMatrix, pMatrix, childrenPositions, [1, 1, 0, 1], gl.POINTS, 7.0)
        }

        // Render Parent (Black)
        if (parentPositions.length > 0) {
            this.draw(gl, mvMatrix, pMatrix, parentPositions, [0, 0, 0, 1], gl.POINTS, 8.0)
        }

        // Render Selected (Red) - Draw last to be on top
        if (selectedPositions.length > 0) {
            this.draw(gl, mvMatrix, pMatrix, selectedPositions, [1, 0, 0, 1], gl.POINTS, 8.0)
        }
    }

    renderPoints(
        gl: WebGLRenderingContext | WebGL2RenderingContext,
        mvMatrix: mat4,
        pMatrix: mat4,
        positions: number[] | Float32Array,
        color: number[],
        size: number = 5.0
    ) {
        this.draw(gl, mvMatrix, pMatrix, positions, color, gl.POINTS, size)
    }

    renderTriangles(
        gl: WebGLRenderingContext | WebGL2RenderingContext,
        mvMatrix: mat4,
        pMatrix: mat4,
        positions: number[] | Float32Array,
        color: number[]
    ) {
        this.draw(gl, mvMatrix, pMatrix, positions, color, gl.TRIANGLES, 1.0)
    }

    renderFaces(
        gl: WebGLRenderingContext | WebGL2RenderingContext,
        mvMatrix: mat4,
        pMatrix: mat4,
        positions: number[] | Float32Array,
        color: number[]
    ) {
        this.renderTriangles(gl, mvMatrix, pMatrix, positions, color)
    }

    renderLines(
        gl: WebGLRenderingContext | WebGL2RenderingContext,
        mvMatrix: mat4,
        pMatrix: mat4,
        positions: number[] | Float32Array,
        color: number[]
    ) {
        this.draw(gl, mvMatrix, pMatrix, positions, color, gl.LINES, 1.0)
    }

    private draw(
        gl: WebGLRenderingContext | WebGL2RenderingContext,
        mvMatrix: mat4,
        pMatrix: mat4,
        positions: number[] | Float32Array,
        color: number[],
        mode: number,
        pointSize: number
    ) {
        if (!this.program || !this.buffer || positions.length === 0) return

        gl.useProgram(this.program)

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer)
        const data = positions instanceof Float32Array ? positions : new Float32Array(positions)
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW)

        gl.enableVertexAttribArray(this.aPosition)
        gl.vertexAttribPointer(this.aPosition, 3, gl.FLOAT, false, 0, 0)

        gl.uniformMatrix4fv(this.uMVMatrix, false, mvMatrix)
        gl.uniformMatrix4fv(this.uPMatrix, false, pMatrix)
        gl.uniform4fv(this.uColor, color)
        gl.uniform1f(this.uPointSize, pointSize)

        // Disable depth test to see through model
        gl.disable(gl.DEPTH_TEST)

        gl.drawArrays(mode, 0, positions.length / 3)

        // Restore depth test
        gl.enable(gl.DEPTH_TEST)
    }
}
