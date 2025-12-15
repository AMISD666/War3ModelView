import { mat4, vec3, mat3 } from 'gl-matrix'

// Simple shader for lines and points
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

// Lit shader for solid cubes with normals
const vsCubeSource = `
  attribute vec3 aPosition;
  attribute vec3 aNormal;
  uniform mat4 uMVMatrix;
  uniform mat4 uPMatrix;
  uniform mat3 uNormalMatrix;
  varying vec3 vNormal;
  varying vec3 vPosition;
  void main() {
    vec4 worldPos = uMVMatrix * vec4(aPosition, 1.0);
    gl_Position = uPMatrix * worldPos;
    vNormal = uNormalMatrix * aNormal;
    vPosition = worldPos.xyz;
  }
`

const fsCubeSource = `
  precision mediump float;
  uniform vec4 uColor;
  varying vec3 vNormal;
  varying vec3 vPosition;
  void main() {
    vec3 normal = normalize(vNormal);
    vec3 lightDir = normalize(vec3(0.5, 0.5, 1.0));
    
    float ambient = 0.35;
    float diffuse = max(dot(normal, lightDir), 0.0) * 0.65;
    float lighting = ambient + diffuse;
    
    vec3 finalColor = uColor.rgb * lighting;
    gl_FragColor = vec4(finalColor, uColor.a);
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

    // Cube program
    private cubeProgram: WebGLProgram | null = null
    private cubeAPosition: number = -1
    private cubeANormal: number = -1
    private cubeUMVMatrix: WebGLUniformLocation | null = null
    private cubeUPMatrix: WebGLUniformLocation | null = null
    private cubeUNormalMatrix: WebGLUniformLocation | null = null
    private cubeUColor: WebGLUniformLocation | null = null
    private cubeVertBuffer: WebGLBuffer | null = null
    private cubeNormBuffer: WebGLBuffer | null = null

    init(gl: WebGLRenderingContext | WebGL2RenderingContext) {
        // Simple program
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

        // Cube program
        const vsCube = this.compileShader(gl, gl.VERTEX_SHADER, vsCubeSource)
        const fsCube = this.compileShader(gl, gl.FRAGMENT_SHADER, fsCubeSource)
        if (!vsCube || !fsCube) return

        this.cubeProgram = gl.createProgram()
        if (!this.cubeProgram) return

        gl.attachShader(this.cubeProgram, vsCube)
        gl.attachShader(this.cubeProgram, fsCube)
        gl.linkProgram(this.cubeProgram)

        if (!gl.getProgramParameter(this.cubeProgram, gl.LINK_STATUS)) {
            console.error('DebugRenderer cube shader link error:', gl.getProgramInfoLog(this.cubeProgram))
            return
        }

        this.cubeAPosition = gl.getAttribLocation(this.cubeProgram, 'aPosition')
        this.cubeANormal = gl.getAttribLocation(this.cubeProgram, 'aNormal')
        this.cubeUMVMatrix = gl.getUniformLocation(this.cubeProgram, 'uMVMatrix')
        this.cubeUPMatrix = gl.getUniformLocation(this.cubeProgram, 'uPMatrix')
        this.cubeUNormalMatrix = gl.getUniformLocation(this.cubeProgram, 'uNormalMatrix')
        this.cubeUColor = gl.getUniformLocation(this.cubeProgram, 'uColor')
        this.cubeVertBuffer = gl.createBuffer()
        this.cubeNormBuffer = gl.createBuffer()
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
        if (!this.cubeProgram || !this.cubeVertBuffer || !this.cubeNormBuffer) return

        const cubeSize = 1.2 // Half-size of cube
        const s = cubeSize

        // Cube faces (6 faces, 2 triangles each = 36 vertices)
        const baseCubeVerts = [
            // Front face (Z+)
            -s, -s, s, s, -s, s, s, s, s,
            -s, -s, s, s, s, s, -s, s, s,
            // Back face (Z-)
            s, -s, -s, -s, -s, -s, -s, s, -s,
            s, -s, -s, -s, s, -s, s, s, -s,
            // Top face (Y+)
            -s, s, s, s, s, s, s, s, -s,
            -s, s, s, s, s, -s, -s, s, -s,
            // Bottom face (Y-)
            -s, -s, -s, s, -s, -s, s, -s, s,
            -s, -s, -s, s, -s, s, -s, -s, s,
            // Right face (X+)
            s, -s, s, s, -s, -s, s, s, -s,
            s, -s, s, s, s, -s, s, s, s,
            // Left face (X-)
            -s, -s, -s, -s, -s, s, -s, s, s,
            -s, -s, -s, -s, s, s, -s, s, -s,
        ]

        // Per-vertex normals (same for each face)
        const baseCubeNormals = [
            // Front face
            0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
            // Back face
            0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,
            // Top face
            0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
            // Bottom face
            0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0,
            // Right face
            1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
            // Left face
            -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,
        ]

        gl.useProgram(this.cubeProgram)
        gl.disable(gl.DEPTH_TEST)
        gl.enable(gl.CULL_FACE)
        gl.cullFace(gl.BACK)

        const tempVec = vec3.create()
        const tempNormal = vec3.create()
        const normalMatrix = mat3.create()

        for (const node of nodes) {
            if (!node.node.PivotPoint) continue

            // Determine color based on selection state
            let color: number[]
            if (selectedNodeIds.includes(node.node.ObjectId)) {
                color = [1, 0, 0, 1] // Red - selected
            } else if (node.node.ObjectId === parentOfSelected) {
                color = [0.2, 0.2, 0.2, 1] // Dark gray - parent (black is hard to see with lighting)
            } else if (childrenOfSelected.includes(node.node.ObjectId)) {
                color = [1, 1, 0, 1] // Yellow - children
            } else {
                color = [0.2, 0.8, 0.2, 1] // Green - default
            }

            // Transform cube vertices by node matrix
            // Cube vertices need to be offset by PivotPoint first (like original point rendering)
            const pivot = node.node.PivotPoint
            const transformedVerts: number[] = []
            for (let i = 0; i < baseCubeVerts.length; i += 3) {
                // Add PivotPoint offset to cube vertex, then transform
                vec3.set(tempVec,
                    baseCubeVerts[i] + pivot[0],
                    baseCubeVerts[i + 1] + pivot[1],
                    baseCubeVerts[i + 2] + pivot[2]
                )
                vec3.transformMat4(tempVec, tempVec, node.matrix)
                transformedVerts.push(tempVec[0], tempVec[1], tempVec[2])
            }

            // Calculate normal matrix from node matrix
            mat3.normalFromMat4(normalMatrix, node.matrix)

            // Transform normals
            const transformedNormals: number[] = []
            for (let i = 0; i < baseCubeNormals.length; i += 3) {
                vec3.set(tempNormal, baseCubeNormals[i], baseCubeNormals[i + 1], baseCubeNormals[i + 2])
                vec3.transformMat3(tempNormal, tempNormal, normalMatrix)
                vec3.normalize(tempNormal, tempNormal)
                transformedNormals.push(tempNormal[0], tempNormal[1], tempNormal[2])
            }

            // Upload vertex data
            gl.bindBuffer(gl.ARRAY_BUFFER, this.cubeVertBuffer)
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(transformedVerts), gl.DYNAMIC_DRAW)
            gl.enableVertexAttribArray(this.cubeAPosition)
            gl.vertexAttribPointer(this.cubeAPosition, 3, gl.FLOAT, false, 0, 0)

            // Upload normal data
            gl.bindBuffer(gl.ARRAY_BUFFER, this.cubeNormBuffer)
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(transformedNormals), gl.DYNAMIC_DRAW)
            gl.enableVertexAttribArray(this.cubeANormal)
            gl.vertexAttribPointer(this.cubeANormal, 3, gl.FLOAT, false, 0, 0)

            // Set uniforms
            gl.uniformMatrix4fv(this.cubeUMVMatrix, false, mvMatrix)
            gl.uniformMatrix4fv(this.cubeUPMatrix, false, pMatrix)
            gl.uniformMatrix3fv(this.cubeUNormalMatrix, false, normalMatrix)
            gl.uniform4fv(this.cubeUColor, color)

            // Draw
            gl.drawArrays(gl.TRIANGLES, 0, 36)
        }

        // Restore state
        gl.disable(gl.CULL_FACE)
        gl.enable(gl.DEPTH_TEST)
    }

    renderBoneVertices(
        gl: WebGLRenderingContext | WebGL2RenderingContext,
        mvMatrix: mat4,
        pMatrix: mat4,
        positions: number[] | Float32Array
    ) {
        // Cyan color for bone-bound vertices
        this.draw(gl, mvMatrix, pMatrix, positions, [0.0, 1.0, 1.0, 1.0], gl.POINTS, 8.0)
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
