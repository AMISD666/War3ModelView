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

    renderWireframeBox(
        gl: WebGLRenderingContext | WebGL2RenderingContext,
        mvMatrix: mat4,
        pMatrix: mat4,
        min: Float32Array | number[],
        max: Float32Array | number[],
        color: number[]
    ) {
        const x1 = min[0], y1 = min[1], z1 = min[2];
        const x2 = max[0], y2 = max[1], z2 = max[2];

        const lines = [
            // Bottom
            x1, y1, z1, x2, y1, z1,
            x2, y1, z1, x2, y2, z1,
            x2, y2, z1, x1, y2, z1,
            x1, y2, z1, x1, y1, z1,
            // Top
            x1, y1, z2, x2, y1, z2,
            x2, y1, z2, x2, y2, z2,
            x2, y2, z2, x1, y2, z2,
            x1, y2, z2, x1, y1, z2,
            // Sides
            x1, y1, z1, x1, y1, z2,
            x2, y1, z1, x2, y1, z2,
            x2, y2, z1, x2, y2, z2,
            x1, y2, z1, x1, y2, z2
        ];
        this.renderLines(gl, mvMatrix, pMatrix, lines, color);
    }

    renderWireframeSphere(
        gl: WebGLRenderingContext | WebGL2RenderingContext,
        mvMatrix: mat4,
        pMatrix: mat4,
        radius: number,
        center: Float32Array | number[], // Added center
        segments: number = 16,
        color: number[]
    ) {
        const lines: number[] = [];
        const cx = center[0], cy = center[1], cz = center[2];

        // XY Circle
        for (let i = 0; i < segments; i++) {
            const theta1 = (i / segments) * Math.PI * 2;
            const theta2 = ((i + 1) / segments) * Math.PI * 2;
            lines.push(cx + Math.cos(theta1) * radius, cy + Math.sin(theta1) * radius, cz);
            lines.push(cx + Math.cos(theta2) * radius, cy + Math.sin(theta2) * radius, cz);
        }
        // XZ Circle
        for (let i = 0; i < segments; i++) {
            const theta1 = (i / segments) * Math.PI * 2;
            const theta2 = ((i + 1) / segments) * Math.PI * 2;
            lines.push(cx + Math.cos(theta1) * radius, cy, cz + Math.sin(theta1) * radius);
            lines.push(cx + Math.cos(theta2) * radius, cy, cz + Math.sin(theta2) * radius);
        }
        // YZ Circle
        for (let i = 0; i < segments; i++) {
            const theta1 = (i / segments) * Math.PI * 2;
            const theta2 = ((i + 1) / segments) * Math.PI * 2;
            lines.push(cx, cy + Math.cos(theta1) * radius, cz + Math.sin(theta1) * radius);
            lines.push(cx, cy + Math.cos(theta2) * radius, cz + Math.sin(theta2) * radius);
        }
        this.renderLines(gl, mvMatrix, pMatrix, lines, color);
    }

    /**
     * Render a wireframe camera frustum (truncated pyramid)
     */
    renderWireframeFrustum(
        gl: WebGLRenderingContext | WebGL2RenderingContext,
        mvMatrix: mat4,
        pMatrix: mat4,
        position: number[],
        target: number[],
        fov: number,
        nearClip: number,
        farClip: number,
        color: number[],
        aspectRatio: number = 4 / 3
    ) {
        const maxVisualFar = Math.min(farClip, 500);
        const dx = target[0] - position[0];
        const dy = target[1] - position[1];
        const dz = target[2] - position[2];
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (dist < 0.001) return;

        const fwd = [dx / dist, dy / dist, dz / dist];
        let upVec = [0, 0, 1];
        const dotUp = fwd[0] * upVec[0] + fwd[1] * upVec[1] + fwd[2] * upVec[2];
        if (Math.abs(dotUp) > 0.99) upVec = [0, 1, 0];

        const right = [
            fwd[1] * upVec[2] - fwd[2] * upVec[1],
            fwd[2] * upVec[0] - fwd[0] * upVec[2],
            fwd[0] * upVec[1] - fwd[1] * upVec[0]
        ];
        const rightLen = Math.sqrt(right[0] * right[0] + right[1] * right[1] + right[2] * right[2]);
        right[0] /= rightLen; right[1] /= rightLen; right[2] /= rightLen;

        const up = [
            right[1] * fwd[2] - right[2] * fwd[1],
            right[2] * fwd[0] - right[0] * fwd[2],
            right[0] * fwd[1] - right[1] * fwd[0]
        ];

        const nearH = nearClip * Math.tan(fov / 2);
        const nearW = nearH * aspectRatio;
        const farH = maxVisualFar * Math.tan(fov / 2);
        const farW = farH * aspectRatio;

        const nc = [position[0] + fwd[0] * nearClip, position[1] + fwd[1] * nearClip, position[2] + fwd[2] * nearClip];
        const ntl = [nc[0] + up[0] * nearH - right[0] * nearW, nc[1] + up[1] * nearH - right[1] * nearW, nc[2] + up[2] * nearH - right[2] * nearW];
        const ntr = [nc[0] + up[0] * nearH + right[0] * nearW, nc[1] + up[1] * nearH + right[1] * nearW, nc[2] + up[2] * nearH + right[2] * nearW];
        const nbl = [nc[0] - up[0] * nearH - right[0] * nearW, nc[1] - up[1] * nearH - right[1] * nearW, nc[2] - up[2] * nearH - right[2] * nearW];
        const nbr = [nc[0] - up[0] * nearH + right[0] * nearW, nc[1] - up[1] * nearH + right[1] * nearW, nc[2] - up[2] * nearH + right[2] * nearW];

        const fc = [position[0] + fwd[0] * maxVisualFar, position[1] + fwd[1] * maxVisualFar, position[2] + fwd[2] * maxVisualFar];
        const ftl = [fc[0] + up[0] * farH - right[0] * farW, fc[1] + up[1] * farH - right[1] * farW, fc[2] + up[2] * farH - right[2] * farW];
        const ftr = [fc[0] + up[0] * farH + right[0] * farW, fc[1] + up[1] * farH + right[1] * farW, fc[2] + up[2] * farH + right[2] * farW];
        const fbl = [fc[0] - up[0] * farH - right[0] * farW, fc[1] - up[1] * farH - right[1] * farW, fc[2] - up[2] * farH - right[2] * farW];
        const fbr = [fc[0] - up[0] * farH + right[0] * farW, fc[1] - up[1] * farH + right[1] * farW, fc[2] - up[2] * farH + right[2] * farW];

        const lines: number[] = [
            ...ntl, ...ntr, ...ntr, ...nbr, ...nbr, ...nbl, ...nbl, ...ntl,
            ...ftl, ...ftr, ...ftr, ...fbr, ...fbr, ...fbl, ...fbl, ...ftl,
            ...ntl, ...ftl, ...ntr, ...ftr, ...nbl, ...fbl, ...nbr, ...fbr,
            ...position, ...nc
        ];

        this.renderLines(gl, mvMatrix, pMatrix, lines, color);
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
        gl.enable(gl.BLEND)
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

        gl.drawArrays(mode, 0, positions.length / 3)

        // Restore state
        gl.disable(gl.BLEND)
        gl.enable(gl.DEPTH_TEST)
    }
    /**
     * Render a visual representation of a light
     */
    renderLight(
        gl: WebGLRenderingContext | WebGL2RenderingContext,
        mvMatrix: mat4,
        pMatrix: mat4,
        type: number, // 0=Omni, 1=Directional, 2=Ambient
        attenuationStart: number,
        attenuationEnd: number,
        color: number[]
    ) {
        // Render a small central sphere for the light source itself
        this.renderWireframeSphere(gl, mvMatrix, pMatrix, 5.0, [0, 0, 0], 8, color);

        // Render Attenuation Ranges for ALL light types if valid
        if (attenuationEnd > 0) {
            this.renderWireframeSphere(gl, mvMatrix, pMatrix, attenuationEnd, [0, 0, 0], 16, [color[0], color[1], color[2], 0.3]);
        }
        if (attenuationStart > 0 && attenuationStart < attenuationEnd) {
            this.renderWireframeSphere(gl, mvMatrix, pMatrix, attenuationStart, [0, 0, 0], 12, [color[0], color[1], color[2], 0.1]);
        }

        if (type === 1) { // Directional
            // Render a pointer/cone indicating direction
            const len = 50.0;
            const lines = [
                0, 0, 0, 0, 0, -len, // Shaft
                // Arrowhead
                0, 0, -len, -5, -5, -len + 10,
                0, 0, -len, 5, -5, -len + 10,
                0, 0, -len, 5, 5, -len + 10,
                0, 0, -len, -5, 5, -len + 10
            ];
            this.renderLines(gl, mvMatrix, pMatrix, lines, color);
        } else if (type === 2) { // Ambient
            // Ambient lights in War3 are often just global, but if they have positions/ranges, visualize them.
            // The user specifically complained about "box size unrelated to params".
            // Since we now render the Attenuation Spheres above, let's keep the central marker simple.
            // But maybe render the box slightly larger or scale it?
            // Actually, if we render the spheres, that addresses the "Range" visualization.
            // Let's keep the small box as an identifier for "Ambient" type.
            this.renderWireframeBox(gl, mvMatrix, pMatrix, [-10, -10, -10], [10, 10, 10], color);
        }
    }
}
