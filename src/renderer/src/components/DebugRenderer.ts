import { mat4, vec3, mat3 } from 'gl-matrix'

// Simple shader for lines and points
const vsSource = `
  attribute vec3 aPosition;
  uniform mat4 uMVMatrix;
  uniform mat4 uPMatrix;
  uniform float uPointSize;
  uniform float uDepthBias; // Add depth bias
  void main() {
    gl_Position = uPMatrix * uMVMatrix * vec4(aPosition, 1.0);
    // Apply depth bias in clip space (towards camera)
    // Z is distorted by W, so scale bias by W to keep it consistent-ish in screen space depth
    // Or just subtract constant? In perspective, subtract from Z before division.
    // Standard trick: gl_Position.z -= uDepthBias * gl_Position.w;
    if (uDepthBias != 0.0) {
        gl_Position.z -= uDepthBias * gl_Position.w;
    }
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
    vec3 lightDir = normalize(vec3(-0.2, 0.5, 1.0)); // Top-left-front
    
    // Base brightness 0.4 + 0.6 directional for high contrast
    float lighting = 0.4 + 0.6 * max(dot(normal, lightDir), 0.0);
    
    vec3 finalColor = uColor.rgb * lighting;
    gl_FragColor = vec4(finalColor, uColor.a);
  }
`

interface NodeWrapper {
    node: {
        ObjectId: number
        Parent?: number | null
        PivotPoint?: Float32Array
        type?: string
    }
    matrix?: Float32Array
}

export class DebugRenderer {
    private program: WebGLProgram | null = null
    private aPosition: number = -1
    private uMVMatrix: WebGLUniformLocation | null = null
    private uPMatrix: WebGLUniformLocation | null = null
    private uColor: WebGLUniformLocation | null = null
    private uPointSize: WebGLUniformLocation | null = null
    private uDepthBias: WebGLUniformLocation | null = null // New uniform
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

    // Sphere data (cached)
    private sphereVerts: Float32Array | null = null
    private sphereNormals: Float32Array | null = null
    private sphereBuffer: WebGLBuffer | null = null
    private sphereNormalBuffer: WebGLBuffer | null = null

    // Tetrahedron data
    private tetrahedronVerts: Float32Array | null = null
    private tetrahedronNormals: Float32Array | null = null
    private tetrahedronBuffer: WebGLBuffer | null = null
    private tetrahedronNormalBuffer: WebGLBuffer | null = null

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
        this.uDepthBias = gl.getUniformLocation(this.program, 'uDepthBias') // Get location
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
        childrenOfSelected: number[] = [],
        typeColors?: Record<string, number[]>
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
            if (!node.matrix) continue
            // Skip attachment nodes - they are rendered separately as tetrahedrons
            if ((node.node as any).type === 'Attachment') continue

            // Determine color based on selection state and node type
            const fallbackColors: Record<string, number[]> = {
                Bone: [0.0, 1.0, 0.4, 1],
                Helper: [0.2, 0.6, 1.0, 1],
                Attachment: [1.0, 1.0, 0.0, 1],
                ParticleEmitter: [1.0, 0.6, 0.2, 1],
                ParticleEmitter2: [1.0, 0.4, 0.8, 1],
                RibbonEmitter: [0.7, 0.5, 1.0, 1],
                Light: [1.0, 1.0, 0.4, 1],
                EventObject: [0.6, 0.6, 1.0, 1],
                CollisionShape: [0.5, 1.0, 0.8, 1],
                Camera: [0.5, 0.9, 1.0, 1],
                ParticleEmitterPopcorn: [1.0, 0.8, 0.4, 1]
            }

            let color: number[]
            if (selectedNodeIds.includes(node.node.ObjectId)) {
                color = [1.0, 0.3, 0.3, 1] // Bright red - selected
            } else if (node.node.ObjectId === parentOfSelected) {
                color = [1.0, 0.6, 0.0, 1] // Bright Orange - parent
            } else if (childrenOfSelected.includes(node.node.ObjectId)) {
                color = [1.0, 1.0, 0.3, 1] // Bright yellow - children
            } else {
                const colorMap = typeColors || fallbackColors
                color = colorMap[(node.node as any).type || ''] || [0.4, 1.0, 0.4, 1]
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

            // 为父骨骼和子骨骼渲染亮青色实体边框（不受光照影响）
            const isParentOrChild = node.node.ObjectId === parentOfSelected || childrenOfSelected.includes(node.node.ObjectId)
            if (isParentOrChild && this.program) {
                const outlineSize = cubeSize * 1.1 // 边框比立方体大10%
                const os = outlineSize
                // 大一点的实体立方体顶点（与 baseCubeVerts 相同结构但尺寸不同）
                const outlineCubeVerts = [
                    // Front face (Z+)
                    -os, -os, os, os, -os, os, os, os, os,
                    -os, -os, os, os, os, os, -os, os, os,
                    // Back face (Z-)
                    os, -os, -os, -os, -os, -os, -os, os, -os,
                    os, -os, -os, -os, os, -os, os, os, -os,
                    // Top face (Y+)
                    -os, os, os, os, os, os, os, os, -os,
                    -os, os, os, os, os, -os, -os, os, -os,
                    // Bottom face (Y-)
                    -os, -os, -os, os, -os, -os, os, -os, os,
                    -os, -os, -os, os, -os, os, -os, -os, os,
                    // Right face (X+)
                    os, -os, os, os, -os, -os, os, os, -os,
                    os, -os, os, os, os, -os, os, os, os,
                    // Left face (X-)
                    -os, -os, -os, -os, -os, os, -os, os, os,
                    -os, -os, -os, -os, os, os, -os, os, -os,
                ]
                // 变换顶点
                const outlineTransformed: number[] = []
                for (let i = 0; i < outlineCubeVerts.length; i += 3) {
                    vec3.set(tempVec,
                        outlineCubeVerts[i] + pivot[0],
                        outlineCubeVerts[i + 1] + pivot[1],
                        outlineCubeVerts[i + 2] + pivot[2]
                    )
                    vec3.transformMat4(tempVec, tempVec, node.matrix)
                    outlineTransformed.push(tempVec[0], tempVec[1], tempVec[2])
                }
                // 使用简单着色器程序渲染（不受光照影响）
                gl.useProgram(this.program)
                gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer)
                gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(outlineTransformed), gl.DYNAMIC_DRAW)
                gl.enableVertexAttribArray(this.aPosition)
                gl.vertexAttribPointer(this.aPosition, 3, gl.FLOAT, false, 0, 0)
                gl.uniformMatrix4fv(this.uMVMatrix, false, mvMatrix)
                gl.uniformMatrix4fv(this.uPMatrix, false, pMatrix)
                gl.uniform4fv(this.uColor, [0.0, 1.0, 1.0, 1.0]) // 亮青色
                gl.uniform1f(this.uPointSize, 1.0)
                gl.uniform1f(this.uDepthBias, 0.0) // No bias for outline?
                gl.drawArrays(gl.TRIANGLES, 0, 36)
                // 切换回立方体程序
                gl.useProgram(this.cubeProgram)
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
        // Always show bone vertices (disable depth)
        this.draw(gl, mvMatrix, pMatrix, positions, [0.0, 1.0, 1.0, 1.0], gl.POINTS, 8.0, false)
    }

    /**
     * Render attachment nodes as yellow tetrahedrons (matching view mode style)
     */
    renderAttachmentNodes(
        gl: WebGLRenderingContext | WebGL2RenderingContext,
        mvMatrix: mat4,
        pMatrix: mat4,
        nodes: NodeWrapper[],
        selectedNodeIds: number[] = [],
        typeColors?: Record<string, number[]>
    ) {
        if (!this.cubeProgram) return

        // Filter to only attachment nodes
        const attachmentNodes = nodes.filter((n: any) =>
            n.node.type === 'Attachment' && n.node.PivotPoint
        )
        if (attachmentNodes.length === 0) return

        // Ensure tetrahedron geometry is generated
        if (!this.tetrahedronVerts) {
            const geo = this.generateTetrahedronGeometry(1.0);
            this.tetrahedronVerts = geo.verts;
            this.tetrahedronNormals = geo.normals;
            this.tetrahedronBuffer = gl.createBuffer();
            this.tetrahedronNormalBuffer = gl.createBuffer();

            gl.bindBuffer(gl.ARRAY_BUFFER, this.tetrahedronBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, this.tetrahedronVerts, gl.STATIC_DRAW);

            gl.bindBuffer(gl.ARRAY_BUFFER, this.tetrahedronNormalBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, this.tetrahedronNormals, gl.STATIC_DRAW);
        }

        gl.useProgram(this.cubeProgram)
        gl.disable(gl.DEPTH_TEST)
        gl.disable(gl.CULL_FACE)

        const modelMatrix = mat4.create()
        const normalMatrix = mat3.create()
        const nodeMVMatrix = mat4.create()
        const tempVec = vec3.create()
        const size = 1.5 // Same as view mode

        // Setup attributes
        gl.bindBuffer(gl.ARRAY_BUFFER, this.tetrahedronBuffer)
        gl.enableVertexAttribArray(this.cubeAPosition)
        gl.vertexAttribPointer(this.cubeAPosition, 3, gl.FLOAT, false, 0, 0)

        gl.bindBuffer(gl.ARRAY_BUFFER, this.tetrahedronNormalBuffer)
        gl.enableVertexAttribArray(this.cubeANormal)
        gl.vertexAttribPointer(this.cubeANormal, 3, gl.FLOAT, false, 0, 0)

        for (const node of attachmentNodes) {
            const pivot = node.node.PivotPoint

            if (!node.matrix) continue

            // Transform pivot by node matrix to get world position
            vec3.transformMat4(tempVec, pivot as vec3, node.matrix)

            // Build model matrix for tetrahedron at this position
            mat4.identity(modelMatrix)
            mat4.translate(modelMatrix, modelMatrix, [tempVec[0], tempVec[1], tempVec[2]])
            mat4.scale(modelMatrix, modelMatrix, [size, size, size])

            mat4.multiply(nodeMVMatrix, mvMatrix, modelMatrix)
            mat3.normalFromMat4(normalMatrix, nodeMVMatrix)

            const fallback = typeColors?.Attachment || [1.0, 1.0, 0.0, 1.0]
            // Determine color: red if selected, otherwise use attachment color
            const isSelected = selectedNodeIds.includes(node.node.ObjectId)
            const color = isSelected ? [1.0, 0.3, 0.3, 1.0] : fallback

            gl.uniformMatrix4fv(this.cubeUMVMatrix, false, nodeMVMatrix)
            gl.uniformMatrix4fv(this.cubeUPMatrix, false, pMatrix)
            gl.uniformMatrix3fv(this.cubeUNormalMatrix, false, normalMatrix)
            gl.uniform4fv(this.cubeUColor, color)

            gl.drawArrays(gl.TRIANGLES, 0, 12) // 4 faces * 3 vertices
        }

        gl.enable(gl.DEPTH_TEST)
    }

    renderPoints(
        gl: WebGLRenderingContext | WebGL2RenderingContext,
        mvMatrix: mat4,
        pMatrix: mat4,
        positions: number[] | Float32Array,
        color: number[],
        size: number = 5.0,
        enableDepth: boolean = false,
        enableBlend: boolean = true
    ) {
        // Use a small depth bias when depth is enabled to prevent Z-fighting with surface
        // Note: depthBias is handled internally by draw() when enableDepth is true
        this.draw(gl, mvMatrix, pMatrix, positions, color, gl.POINTS, size, enableDepth, enableBlend)
    }

    renderTriangles(
        gl: WebGLRenderingContext | WebGL2RenderingContext,
        mvMatrix: mat4,
        pMatrix: mat4,
        positions: number[] | Float32Array,
        color: number[],
        enableBlend: boolean = true
    ) {
        this.draw(gl, mvMatrix, pMatrix, positions, color, gl.TRIANGLES, 1.0, false, enableBlend)
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
        color: number[],
        enableBlend: boolean = true
    ) {
        this.draw(gl, mvMatrix, pMatrix, positions, color, gl.LINES, 1.0, false, enableBlend)
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
        pointSize: number,
        enableDepth: boolean = false, // Default to false (penetrate) to match previous behavior
        enableBlend: boolean = true
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
        gl.uniform1f(this.uDepthBias, 0.0) // Set default bias to 0 to avoid garbage values

        // Save GL state to avoid inheriting material blend modes
        const prevBlend = gl.isEnabled(gl.BLEND)
        const prevBlendSrcRGB = gl.getParameter(gl.BLEND_SRC_RGB)
        const prevBlendDstRGB = gl.getParameter(gl.BLEND_DST_RGB)
        const prevBlendSrcAlpha = gl.getParameter(gl.BLEND_SRC_ALPHA)
        const prevBlendDstAlpha = gl.getParameter(gl.BLEND_DST_ALPHA)
        const prevBlendEqRGB = gl.getParameter(gl.BLEND_EQUATION_RGB)
        const prevBlendEqAlpha = gl.getParameter(gl.BLEND_EQUATION_ALPHA)
        const prevDepthTest = gl.isEnabled(gl.DEPTH_TEST)
        const prevCullFace = gl.isEnabled(gl.CULL_FACE)

        // Configure depth test based on parameter
        if (enableDepth) {
            gl.enable(gl.DEPTH_TEST)
        } else {
            gl.disable(gl.DEPTH_TEST)
        }

        // Force double-sided overlay for selection/highlight
        gl.disable(gl.CULL_FACE)

        if (enableBlend) {
            // Force a stable blend mode for selection/debug overlays
            gl.enable(gl.BLEND)
            gl.blendEquationSeparate(gl.FUNC_ADD, gl.FUNC_ADD)
            gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
        } else {
            gl.disable(gl.BLEND)
        }

        gl.drawArrays(mode, 0, positions.length / 3)

        // Restore state
        gl.blendEquationSeparate(prevBlendEqRGB, prevBlendEqAlpha)
        gl.blendFuncSeparate(prevBlendSrcRGB, prevBlendDstRGB, prevBlendSrcAlpha, prevBlendDstAlpha)
        if (prevBlend) {
            gl.enable(gl.BLEND)
        } else {
            gl.disable(gl.BLEND)
        }
        if (prevCullFace) {
            gl.enable(gl.CULL_FACE)
        } else {
            gl.disable(gl.CULL_FACE)
        }
        if (prevDepthTest) {
            gl.enable(gl.DEPTH_TEST)
        } else {
            gl.disable(gl.DEPTH_TEST)
        }
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

    /**
     * 在指定位置渲染本地坐标轴（只读，用于关键帧模式选中骨骼）
     * @param center 坐标轴中心位置
     * @param matrix 节点变换矩阵（用于计算旋转后的轴向）
     * @param scale 坐标轴长度
     */
    renderLocalAxes(
        gl: WebGLRenderingContext | WebGL2RenderingContext,
        mvMatrix: mat4,
        pMatrix: mat4,
        center: number[] | Float32Array,
        nodeMatrix: mat4,
        scale: number = 15
    ) {
        if (!this.program || !this.buffer) return

        // 从节点矩阵中提取旋转后的轴向
        const xAxis = vec3.fromValues(nodeMatrix[0], nodeMatrix[1], nodeMatrix[2])
        const yAxis = vec3.fromValues(nodeMatrix[4], nodeMatrix[5], nodeMatrix[6])
        const zAxis = vec3.fromValues(nodeMatrix[8], nodeMatrix[9], nodeMatrix[10])

        // 归一化并缩放
        vec3.normalize(xAxis, xAxis)
        vec3.normalize(yAxis, yAxis)
        vec3.normalize(zAxis, zAxis)
        vec3.scale(xAxis, xAxis, scale)
        vec3.scale(yAxis, yAxis, scale)
        vec3.scale(zAxis, zAxis, scale)

        const cx = center[0], cy = center[1], cz = center[2]

        // X轴 - 红色
        const xLines = [
            cx, cy, cz,
            cx + xAxis[0], cy + xAxis[1], cz + xAxis[2]
        ]
        this.renderLines(gl, mvMatrix, pMatrix, xLines, [1, 0, 0, 1])

        // Y轴 - 绿色
        const yLines = [
            cx, cy, cz,
            cx + yAxis[0], cy + yAxis[1], cz + yAxis[2]
        ]
        this.renderLines(gl, mvMatrix, pMatrix, yLines, [0, 1, 0, 1])

        // Z轴 - 蓝色
        const zLines = [
            cx, cy, cz,
            cx + zAxis[0], cy + zAxis[1], cz + zAxis[2]
        ]
        this.renderLines(gl, mvMatrix, pMatrix, zLines, [0, 0, 1, 1])
    }

    private generateSphereGeometry(radius: number, segments: number): { verts: Float32Array, normals: Float32Array } {
        const verts: number[] = [];
        const normals: number[] = [];

        for (let lat = 0; lat <= segments; lat++) {
            const theta = lat * Math.PI / segments;
            const sinTheta = Math.sin(theta);
            const cosTheta = Math.cos(theta);

            for (let lon = 0; lon <= segments; lon++) {
                const phi = lon * 2 * Math.PI / segments;
                const sinPhi = Math.sin(phi);
                const cosPhi = Math.cos(phi);

                const x = cosPhi * sinTheta;
                const y = cosTheta;
                const z = sinPhi * sinTheta;

                normals.push(x, y, z);
                verts.push(radius * x, radius * y, radius * z);
            }
        }

        const triVerts: number[] = [];
        const triNormals: number[] = [];

        for (let lat = 0; lat < segments; lat++) {
            for (let lon = 0; lon < segments; lon++) {
                const first = (lat * (segments + 1)) + lon;
                const second = first + segments + 1;

                // Triangle 1
                triVerts.push(verts[first * 3], verts[first * 3 + 1], verts[first * 3 + 2]);
                triVerts.push(verts[second * 3], verts[second * 3 + 1], verts[second * 3 + 2]);
                triVerts.push(verts[(first + 1) * 3], verts[(first + 1) * 3 + 1], verts[(first + 1) * 3 + 2]);

                triNormals.push(normals[first * 3], normals[first * 3 + 1], normals[first * 3 + 2]);
                triNormals.push(normals[second * 3], normals[second * 3 + 1], normals[second * 3 + 2]);
                triNormals.push(normals[(first + 1) * 3], normals[(first + 1) * 3 + 1], normals[(first + 1) * 3 + 2]);

                // Triangle 2
                triVerts.push(verts[(first + 1) * 3], verts[(first + 1) * 3 + 1], verts[(first + 1) * 3 + 2]);
                triVerts.push(verts[second * 3], verts[second * 3 + 1], verts[second * 3 + 2]);
                triVerts.push(verts[(second + 1) * 3], verts[(second + 1) * 3 + 1], verts[(second + 1) * 3 + 2]);

                triNormals.push(normals[(first + 1) * 3], normals[(first + 1) * 3 + 1], normals[(first + 1) * 3 + 2]);
                triNormals.push(normals[second * 3], normals[second * 3 + 1], normals[second * 3 + 2]);
                triNormals.push(normals[(second + 1) * 3], normals[(second + 1) * 3 + 1], normals[(second + 1) * 3 + 2]);
            }
        }

        return {
            verts: new Float32Array(triVerts),
            normals: new Float32Array(triNormals)
        };
    }

    renderSolidSpheres(
        gl: WebGLRenderingContext | WebGL2RenderingContext,
        mvMatrix: mat4,
        pMatrix: mat4,
        positions: number[],
        radius: number,
        color: number[],
        enableDepth: boolean = true
    ) {
        if (!this.cubeProgram) return;

        // Ensure sphere geometry is generated
        if (!this.sphereVerts) {
            const geo = this.generateSphereGeometry(1.0, 32); // High quality sphere
            this.sphereVerts = geo.verts;
            this.sphereNormals = geo.normals;
            this.sphereBuffer = gl.createBuffer();
            this.sphereNormalBuffer = gl.createBuffer();

            gl.bindBuffer(gl.ARRAY_BUFFER, this.sphereBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, this.sphereVerts, gl.STATIC_DRAW);

            gl.bindBuffer(gl.ARRAY_BUFFER, this.sphereNormalBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, this.sphereNormals, gl.STATIC_DRAW);
        }

        gl.useProgram(this.cubeProgram);

        if (enableDepth) {
            gl.enable(gl.DEPTH_TEST);
        } else {
            gl.disable(gl.DEPTH_TEST);
        }

        gl.disable(gl.CULL_FACE); // Ensure spheres are visible regardless of winding/orientation

        const modelMatrix = mat4.create();
        const normalMatrix = mat3.create();
        const nodeMVMatrix = mat4.create();

        // Setup attributes
        gl.bindBuffer(gl.ARRAY_BUFFER, this.sphereBuffer);
        gl.enableVertexAttribArray(this.cubeAPosition);
        gl.vertexAttribPointer(this.cubeAPosition, 3, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.sphereNormalBuffer);
        gl.enableVertexAttribArray(this.cubeANormal);
        gl.vertexAttribPointer(this.cubeANormal, 3, gl.FLOAT, false, 0, 0);

        gl.uniform4fv(this.cubeUColor, color);

        for (let i = 0; i < positions.length; i += 3) {
            mat4.identity(modelMatrix);
            mat4.translate(modelMatrix, modelMatrix, [positions[i], positions[i + 1], positions[i + 2]]);
            mat4.scale(modelMatrix, modelMatrix, [radius, radius, radius]);

            mat4.multiply(nodeMVMatrix, mvMatrix, modelMatrix);
            mat3.normalFromMat4(normalMatrix, nodeMVMatrix);

            gl.uniformMatrix4fv(this.cubeUMVMatrix, false, nodeMVMatrix);
            gl.uniformMatrix4fv(this.cubeUPMatrix, false, pMatrix);
            gl.uniformMatrix3fv(this.cubeUNormalMatrix, false, normalMatrix);

            gl.drawArrays(gl.TRIANGLES, 0, this.sphereVerts!.length / 3);
        }

        gl.enable(gl.DEPTH_TEST);
    }

    private generateTetrahedronGeometry(size: number): { verts: Float32Array, normals: Float32Array } {
        // Standard regular tetrahedron vertices
        const s = size;
        const v0 = [0, s, 0];
        const v1 = [-s * 0.94, -s * 0.33, s * 0.54];
        const v2 = [s * 0.94, -s * 0.33, s * 0.54];
        const v3 = [0, -s * 0.33, -s * 1.0];

        const triVerts: number[] = [
            ...v0, ...v2, ...v1, // CCW winding for outward normals
            ...v0, ...v3, ...v2,
            ...v0, ...v1, ...v3,
            ...v1, ...v2, ...v3  // bottom face
        ];

        const calculateNormal = (p1: number[], p2: number[], p3: number[]) => {
            const u = [p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]];
            const v = [p3[0] - p1[0], p3[1] - p1[1], p3[2] - p1[2]];
            const n = [
                u[1] * v[2] - u[2] * v[1],
                u[2] * v[0] - u[0] * v[2],
                u[0] * v[1] - u[1] * v[0]
            ];
            const len = Math.sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]);
            return [n[0] / len, n[1] / len, n[2] / len];
        };

        const n1 = calculateNormal(v0, v2, v1);
        const n2 = calculateNormal(v0, v3, v2);
        const n3 = calculateNormal(v0, v1, v3);
        const n4 = calculateNormal(v1, v2, v3);

        const triNormals: number[] = [
            ...n1, ...n1, ...n1,
            ...n2, ...n2, ...n2,
            ...n3, ...n3, ...n3,
            ...n4, ...n4, ...n4
        ];

        return {
            verts: new Float32Array(triVerts),
            normals: new Float32Array(triNormals)
        };
    }

    renderSolidTetrahedrons(
        gl: WebGLRenderingContext | WebGL2RenderingContext,
        mvMatrix: mat4,
        pMatrix: mat4,
        positions: number[],
        size: number,
        color: number[],
        enableDepth: boolean = true
    ) {
        if (!this.cubeProgram) return;

        if (!this.tetrahedronVerts) {
            const geo = this.generateTetrahedronGeometry(1.0);
            this.tetrahedronVerts = geo.verts;
            this.tetrahedronNormals = geo.normals;
            this.tetrahedronBuffer = gl.createBuffer();
            this.tetrahedronNormalBuffer = gl.createBuffer();

            gl.bindBuffer(gl.ARRAY_BUFFER, this.tetrahedronBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, this.tetrahedronVerts, gl.STATIC_DRAW);

            gl.bindBuffer(gl.ARRAY_BUFFER, this.tetrahedronNormalBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, this.tetrahedronNormals, gl.STATIC_DRAW);
        }

        gl.useProgram(this.cubeProgram);
        gl.disable(gl.CULL_FACE);

        if (enableDepth) {
            gl.enable(gl.DEPTH_TEST);
        } else {
            gl.disable(gl.DEPTH_TEST);
        }

        const modelMatrix = mat4.create();
        const normalMatrix = mat3.create();
        const nodeMVMatrix = mat4.create();

        gl.bindBuffer(gl.ARRAY_BUFFER, this.tetrahedronBuffer);
        gl.enableVertexAttribArray(this.cubeAPosition);
        gl.vertexAttribPointer(this.cubeAPosition, 3, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.tetrahedronNormalBuffer);
        gl.enableVertexAttribArray(this.cubeANormal);
        gl.vertexAttribPointer(this.cubeANormal, 3, gl.FLOAT, false, 0, 0);

        gl.uniform4fv(this.cubeUColor, color);

        for (let i = 0; i < positions.length; i += 3) {
            mat4.identity(modelMatrix);
            mat4.translate(modelMatrix, modelMatrix, [positions[i], positions[i + 1], positions[i + 2]]);
            mat4.scale(modelMatrix, modelMatrix, [size, size, size]);

            mat4.multiply(nodeMVMatrix, mvMatrix, modelMatrix);
            mat3.normalFromMat4(normalMatrix, nodeMVMatrix);

            gl.uniformMatrix4fv(this.cubeUMVMatrix, false, nodeMVMatrix);
            gl.uniformMatrix4fv(this.cubeUPMatrix, false, pMatrix);
            gl.uniformMatrix3fv(this.cubeUNormalMatrix, false, normalMatrix);

            gl.drawArrays(gl.TRIANGLES, 0, 12); // 4 faces * 3 vertices
        }

        gl.enable(gl.DEPTH_TEST);
    }
}
