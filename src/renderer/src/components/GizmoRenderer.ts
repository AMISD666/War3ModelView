import { mat4, vec3 } from 'gl-matrix'

const vsSource = `
  attribute vec3 aPosition;
  attribute vec3 aColor;
  
  uniform mat4 uMVMatrix;
  uniform mat4 uPMatrix;
  
  varying vec3 vColor;
  
  void main() {
    gl_Position = uPMatrix * uMVMatrix * vec4(aPosition, 1.0);
    vColor = aColor;
  }
`

const fsSource = `
  precision mediump float;
  varying vec3 vColor;
  
  void main() {
    gl_FragColor = vec4(vColor, 1.0);
  }
`

export type GizmoMode = 'translate' | 'rotate' | 'scale'
export type GizmoAxis = 'x' | 'y' | 'z' | 'xy' | 'xz' | 'yz' | 'center' | null

export class GizmoRenderer {
    private program: WebGLProgram | null = null
    private aPosition: number = -1
    private aColor: number = -1
    private uMVMatrix: WebGLUniformLocation | null = null
    private uPMatrix: WebGLUniformLocation | null = null

    private buffer: WebGLBuffer | null = null
    private colorBuffer: WebGLBuffer | null = null

    // Gizmo Geometry Data - Fixed size (no adaptive scaling)
    private axisLength = 50.0


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
            console.error('GizmoRenderer shader link error:', gl.getProgramInfoLog(this.program))
            return
        }

        this.aPosition = gl.getAttribLocation(this.program, 'aPosition')
        this.aColor = gl.getAttribLocation(this.program, 'aColor')
        this.uMVMatrix = gl.getUniformLocation(this.program, 'uMVMatrix')
        this.uPMatrix = gl.getUniformLocation(this.program, 'uPMatrix')

        this.buffer = gl.createBuffer()
        this.colorBuffer = gl.createBuffer()
    }

    private compileShader(gl: WebGLRenderingContext | WebGL2RenderingContext, type: number, source: string) {
        const shader = gl.createShader(type)
        if (!shader) return null
        gl.shaderSource(shader, source)
        gl.compileShader(shader)
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error('GizmoRenderer shader compile error:', gl.getShaderInfoLog(shader))
            gl.deleteShader(shader)
            return null
        }
        return shader
    }

    render(
        gl: WebGLRenderingContext | WebGL2RenderingContext,
        mvMatrix: mat4,
        pMatrix: mat4,
        center: vec3,
        mode: GizmoMode,
        highlightAxis: GizmoAxis,
        scale: number = 1.0,
        basis?: { x: vec3, y: vec3, z: vec3 }
    ) {
        if (!this.program || !this.buffer || !this.colorBuffer) return

        gl.useProgram(this.program)

        // Disable depth test to draw on top
        gl.disable(gl.DEPTH_TEST)

        // Construct Gizmo Geometry based on mode
        const positions: number[] = []
        const colors: number[] = []

        const addLine = (start: vec3, end: vec3, color: number[]) => {
            positions.push(start[0], start[1], start[2])
            positions.push(end[0], end[1], end[2])
            colors.push(...color)
            colors.push(...color)
        }
        const addCube = (c: vec3, halfSize: number, color: number[]) => {
            const x0 = c[0] - halfSize, x1 = c[0] + halfSize
            const y0 = c[1] - halfSize, y1 = c[1] + halfSize
            const z0 = c[2] - halfSize, z1 = c[2] + halfSize
            // Bottom square
            addLine(vec3.fromValues(x0, y0, z0), vec3.fromValues(x1, y0, z0), color)
            addLine(vec3.fromValues(x1, y0, z0), vec3.fromValues(x1, y1, z0), color)
            addLine(vec3.fromValues(x1, y1, z0), vec3.fromValues(x0, y1, z0), color)
            addLine(vec3.fromValues(x0, y1, z0), vec3.fromValues(x0, y0, z0), color)
            // Top square
            addLine(vec3.fromValues(x0, y0, z1), vec3.fromValues(x1, y0, z1), color)
            addLine(vec3.fromValues(x1, y0, z1), vec3.fromValues(x1, y1, z1), color)
            addLine(vec3.fromValues(x1, y1, z1), vec3.fromValues(x0, y1, z1), color)
            addLine(vec3.fromValues(x0, y1, z1), vec3.fromValues(x0, y0, z1), color)
            // Vertical edges
            addLine(vec3.fromValues(x0, y0, z0), vec3.fromValues(x0, y0, z1), color)
            addLine(vec3.fromValues(x1, y0, z0), vec3.fromValues(x1, y0, z1), color)
            addLine(vec3.fromValues(x1, y1, z0), vec3.fromValues(x1, y1, z1), color)
            addLine(vec3.fromValues(x0, y1, z0), vec3.fromValues(x0, y1, z1), color)
        }
        const addTriangle = (p1: vec3, p2: vec3, p3: vec3, color: number[]) => {
            addLine(p1, p2, color)
            addLine(p2, p3, color)
            addLine(p3, p1, color)
        }

        // Colors
        const red = highlightAxis === 'x' ? [1, 1, 0] : [1, 0, 0]
        const green = highlightAxis === 'y' ? [1, 1, 0] : [0, 1, 0]
        const blue = highlightAxis === 'z' ? [1, 1, 0] : [0, 0, 1]

        const axisLen = this.axisLength * scale
        const axisX = basis?.x ?? vec3.fromValues(1, 0, 0)
        const axisY = basis?.y ?? vec3.fromValues(0, 1, 0)
        const axisZ = basis?.z ?? vec3.fromValues(0, 0, 1)

        if (mode === 'translate') {
            const xEnd = vec3.create(); vec3.scaleAndAdd(xEnd, center, axisX, axisLen)
            const yEnd = vec3.create(); vec3.scaleAndAdd(yEnd, center, axisY, axisLen)
            const zEnd = vec3.create(); vec3.scaleAndAdd(zEnd, center, axisZ, axisLen)

            addLine(center, xEnd, red)
            addLine(center, yEnd, green)
            addLine(center, zEnd, blue)
        } else if (mode === 'scale') {
            const xEnd = vec3.create(); vec3.scaleAndAdd(xEnd, center, axisX, axisLen)
            const yEnd = vec3.create(); vec3.scaleAndAdd(yEnd, center, axisY, axisLen)
            const zEnd = vec3.create(); vec3.scaleAndAdd(zEnd, center, axisZ, axisLen)

            addLine(center, xEnd, red)
            addLine(center, yEnd, green)
            addLine(center, zEnd, blue)

            const centerColor = highlightAxis === 'center' ? [1, 1, 0] : [0.9, 0.9, 0.9]
            const centerSize = axisLen * 0.064
            addCube(center, centerSize, centerColor)
        } else if (mode === 'rotate') {
            // Draw circles
            const segments = 32
            const r = axisLen * 0.5 // SYNC: must match raycast rotate radius below


            // X-Axis Circle (YZ plane)
            for (let i = 0; i < segments; i++) {
                const theta1 = (i / segments) * Math.PI * 2
                const theta2 = ((i + 1) / segments) * Math.PI * 2
                const p1 = vec3.create()
                vec3.scaleAndAdd(p1, p1, axisY, Math.cos(theta1) * r)
                vec3.scaleAndAdd(p1, p1, axisZ, Math.sin(theta1) * r)
                vec3.add(p1, p1, center)
                const p2 = vec3.create()
                vec3.scaleAndAdd(p2, p2, axisY, Math.cos(theta2) * r)
                vec3.scaleAndAdd(p2, p2, axisZ, Math.sin(theta2) * r)
                vec3.add(p2, p2, center)
                addLine(p1, p2, red)
            }

            // Y-Axis Circle (XZ plane)
            for (let i = 0; i < segments; i++) {
                const theta1 = (i / segments) * Math.PI * 2
                const theta2 = ((i + 1) / segments) * Math.PI * 2
                const p1 = vec3.create()
                vec3.scaleAndAdd(p1, p1, axisX, Math.cos(theta1) * r)
                vec3.scaleAndAdd(p1, p1, axisZ, Math.sin(theta1) * r)
                vec3.add(p1, p1, center)
                const p2 = vec3.create()
                vec3.scaleAndAdd(p2, p2, axisX, Math.cos(theta2) * r)
                vec3.scaleAndAdd(p2, p2, axisZ, Math.sin(theta2) * r)
                vec3.add(p2, p2, center)
                addLine(p1, p2, green)
            }

            // Z-Axis Circle (XY plane)
            for (let i = 0; i < segments; i++) {
                const theta1 = (i / segments) * Math.PI * 2
                const theta2 = ((i + 1) / segments) * Math.PI * 2
                const p1 = vec3.create()
                vec3.scaleAndAdd(p1, p1, axisX, Math.cos(theta1) * r)
                vec3.scaleAndAdd(p1, p1, axisY, Math.sin(theta1) * r)
                vec3.add(p1, p1, center)
                const p2 = vec3.create()
                vec3.scaleAndAdd(p2, p2, axisX, Math.cos(theta2) * r)
                vec3.scaleAndAdd(p2, p2, axisY, Math.sin(theta2) * r)
                vec3.add(p2, p2, center)
                addLine(p1, p2, blue)
            }
        }

        // Planar Handles (Triangles)
        const planeSize = axisLen * 0.35
        const planeOffset = axisLen * 0.1 // Slight offset from origin

        // XY Plane (Blue)
        if (mode === 'translate' || mode === 'scale') {
            const color = highlightAxis === 'xy' ? [1, 1, 0] : [0, 0, 1]
            const p1 = vec3.create()
            vec3.scaleAndAdd(p1, p1, axisX, planeOffset)
            vec3.scaleAndAdd(p1, p1, axisY, planeOffset)
            vec3.add(p1, p1, center)
            const p2 = vec3.create()
            vec3.scaleAndAdd(p2, p2, axisX, planeOffset + planeSize)
            vec3.scaleAndAdd(p2, p2, axisY, planeOffset)
            vec3.add(p2, p2, center)
            const p3 = vec3.create()
            vec3.scaleAndAdd(p3, p3, axisX, planeOffset + planeSize)
            vec3.scaleAndAdd(p3, p3, axisY, planeOffset + planeSize)
            vec3.add(p3, p3, center)
            const p4 = vec3.create()
            vec3.scaleAndAdd(p4, p4, axisX, planeOffset)
            vec3.scaleAndAdd(p4, p4, axisY, planeOffset + planeSize)
            vec3.add(p4, p4, center)
            if (mode === 'translate') {
                addLine(p1, p2, color)
                addLine(p2, p3, color)
                addLine(p3, p4, color)
                addLine(p4, p1, color)
            } else {
                addTriangle(p1, p2, p4, color)
            }
        }

        // XZ Plane (Green)
        if (mode === 'translate' || mode === 'scale') {
            const color = highlightAxis === 'xz' ? [1, 1, 0] : [0, 1, 0]
            const p1 = vec3.create()
            vec3.scaleAndAdd(p1, p1, axisX, planeOffset)
            vec3.scaleAndAdd(p1, p1, axisZ, planeOffset)
            vec3.add(p1, p1, center)
            const p2 = vec3.create()
            vec3.scaleAndAdd(p2, p2, axisX, planeOffset + planeSize)
            vec3.scaleAndAdd(p2, p2, axisZ, planeOffset)
            vec3.add(p2, p2, center)
            const p3 = vec3.create()
            vec3.scaleAndAdd(p3, p3, axisX, planeOffset + planeSize)
            vec3.scaleAndAdd(p3, p3, axisZ, planeOffset + planeSize)
            vec3.add(p3, p3, center)
            const p4 = vec3.create()
            vec3.scaleAndAdd(p4, p4, axisX, planeOffset)
            vec3.scaleAndAdd(p4, p4, axisZ, planeOffset + planeSize)
            vec3.add(p4, p4, center)
            if (mode === 'translate') {
                addLine(p1, p2, color)
                addLine(p2, p3, color)
                addLine(p3, p4, color)
                addLine(p4, p1, color)
            } else {
                addTriangle(p1, p2, p4, color)
            }
        }

        // YZ Plane (Red)
        if (mode === 'translate' || mode === 'scale') {
            const color = highlightAxis === 'yz' ? [1, 1, 0] : [1, 0, 0]
            const p1 = vec3.create()
            vec3.scaleAndAdd(p1, p1, axisY, planeOffset)
            vec3.scaleAndAdd(p1, p1, axisZ, planeOffset)
            vec3.add(p1, p1, center)
            const p2 = vec3.create()
            vec3.scaleAndAdd(p2, p2, axisY, planeOffset + planeSize)
            vec3.scaleAndAdd(p2, p2, axisZ, planeOffset)
            vec3.add(p2, p2, center)
            const p3 = vec3.create()
            vec3.scaleAndAdd(p3, p3, axisY, planeOffset + planeSize)
            vec3.scaleAndAdd(p3, p3, axisZ, planeOffset + planeSize)
            vec3.add(p3, p3, center)
            const p4 = vec3.create()
            vec3.scaleAndAdd(p4, p4, axisY, planeOffset)
            vec3.scaleAndAdd(p4, p4, axisZ, planeOffset + planeSize)
            vec3.add(p4, p4, center)
            if (mode === 'translate') {
                addLine(p1, p2, color)
                addLine(p2, p3, color)
                addLine(p3, p4, color)
                addLine(p4, p1, color)
            } else {
                addTriangle(p1, p2, p4, color)
            }
        }

        // Upload Data
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer)
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.DYNAMIC_DRAW)
        gl.enableVertexAttribArray(this.aPosition)
        gl.vertexAttribPointer(this.aPosition, 3, gl.FLOAT, false, 0, 0)

        gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer)
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colors), gl.DYNAMIC_DRAW)
        gl.enableVertexAttribArray(this.aColor)
        gl.vertexAttribPointer(this.aColor, 3, gl.FLOAT, false, 0, 0)

        // Uniforms
        gl.uniformMatrix4fv(this.uMVMatrix, false, mvMatrix)
        gl.uniformMatrix4fv(this.uPMatrix, false, pMatrix)

        // Draw Lines
        gl.lineWidth(3.0)
        gl.drawArrays(gl.LINES, 0, positions.length / 3)
        gl.lineWidth(1.0)

        // Restore depth test
        gl.enable(gl.DEPTH_TEST)
    }

    // Raycast against the Gizmo axes to find which one is hovered
    raycast(
        cameraPos: vec3,
        rayDir: vec3,
        center: vec3,
        mode: GizmoMode,
        scale: number = 1.0,
        basis?: { x: vec3, y: vec3, z: vec3 }
    ): GizmoAxis {
        // Simplified ray-cylinder intersection (treating lines as cylinders/capsules)
        // For now, we use a distance check to the line segments

        const axisLen = this.axisLength * scale
        const axisX = basis?.x ?? vec3.fromValues(1, 0, 0)
        const axisY = basis?.y ?? vec3.fromValues(0, 1, 0)
        const axisZ = basis?.z ?? vec3.fromValues(0, 0, 1)
        // Keep hit size proportional to axis length so screen-space size stays consistent
        const lineHitThreshold = axisLen * 0.1
        const ringHitThreshold = axisLen * 0.08

        if (mode === 'translate' || mode === 'scale') {
            if (mode === 'scale') {
                const centerHitThreshold = axisLen * 0.18
                const distCenter = this.distToPoint(cameraPos, rayDir, center)
                if (distCenter < centerHitThreshold) {
                    return 'center'
                }
            }
            const xEnd = vec3.create(); vec3.scaleAndAdd(xEnd, center, axisX, axisLen)
            const yEnd = vec3.create(); vec3.scaleAndAdd(yEnd, center, axisY, axisLen)
            const zEnd = vec3.create(); vec3.scaleAndAdd(zEnd, center, axisZ, axisLen)

            const distX = this.distToSegment(cameraPos, rayDir, center, xEnd)
            const distY = this.distToSegment(cameraPos, rayDir, center, yEnd)
            const distZ = this.distToSegment(cameraPos, rayDir, center, zEnd)

            // Find closest hit
            let minDist = lineHitThreshold
            let hitAxis: GizmoAxis = null

            if (distX < minDist) { minDist = distX; hitAxis = 'x' }
            if (distY < minDist) { minDist = distY; hitAxis = 'y' }
            if (distZ < minDist) { minDist = distZ; hitAxis = 'z' }

            // Planar Checks
            const planeSize = axisLen * 0.35
            const planeOffset = axisLen * 0.1

            let distXY = Infinity
            let distXZ = Infinity
            let distYZ = Infinity

            if (mode === 'translate') {
                distXY = this.distToQuad(cameraPos, rayDir,
                    vec3.add(vec3.create(), center, vec3.add(vec3.create(), vec3.scale(vec3.create(), axisX, planeOffset), vec3.scale(vec3.create(), axisY, planeOffset))),
                    vec3.add(vec3.create(), center, vec3.add(vec3.create(), vec3.scale(vec3.create(), axisX, planeOffset + planeSize), vec3.scale(vec3.create(), axisY, planeOffset))),
                    vec3.add(vec3.create(), center, vec3.add(vec3.create(), vec3.scale(vec3.create(), axisX, planeOffset + planeSize), vec3.scale(vec3.create(), axisY, planeOffset + planeSize))),
                    vec3.add(vec3.create(), center, vec3.add(vec3.create(), vec3.scale(vec3.create(), axisX, planeOffset), vec3.scale(vec3.create(), axisY, planeOffset + planeSize)))
                )
                distXZ = this.distToQuad(cameraPos, rayDir,
                    vec3.add(vec3.create(), center, vec3.add(vec3.create(), vec3.scale(vec3.create(), axisX, planeOffset), vec3.scale(vec3.create(), axisZ, planeOffset))),
                    vec3.add(vec3.create(), center, vec3.add(vec3.create(), vec3.scale(vec3.create(), axisX, planeOffset + planeSize), vec3.scale(vec3.create(), axisZ, planeOffset))),
                    vec3.add(vec3.create(), center, vec3.add(vec3.create(), vec3.scale(vec3.create(), axisX, planeOffset + planeSize), vec3.scale(vec3.create(), axisZ, planeOffset + planeSize))),
                    vec3.add(vec3.create(), center, vec3.add(vec3.create(), vec3.scale(vec3.create(), axisX, planeOffset), vec3.scale(vec3.create(), axisZ, planeOffset + planeSize)))
                )
                distYZ = this.distToQuad(cameraPos, rayDir,
                    vec3.add(vec3.create(), center, vec3.add(vec3.create(), vec3.scale(vec3.create(), axisY, planeOffset), vec3.scale(vec3.create(), axisZ, planeOffset))),
                    vec3.add(vec3.create(), center, vec3.add(vec3.create(), vec3.scale(vec3.create(), axisY, planeOffset + planeSize), vec3.scale(vec3.create(), axisZ, planeOffset))),
                    vec3.add(vec3.create(), center, vec3.add(vec3.create(), vec3.scale(vec3.create(), axisY, planeOffset + planeSize), vec3.scale(vec3.create(), axisZ, planeOffset + planeSize))),
                    vec3.add(vec3.create(), center, vec3.add(vec3.create(), vec3.scale(vec3.create(), axisY, planeOffset), vec3.scale(vec3.create(), axisZ, planeOffset + planeSize)))
                )
            } else {
                distXY = this.distToTriangle(cameraPos, rayDir,
                    vec3.add(vec3.create(), center, vec3.add(vec3.create(), vec3.scale(vec3.create(), axisX, planeOffset), vec3.scale(vec3.create(), axisY, planeOffset))),
                    vec3.add(vec3.create(), center, vec3.add(vec3.create(), vec3.scale(vec3.create(), axisX, planeOffset + planeSize), vec3.scale(vec3.create(), axisY, planeOffset))),
                    vec3.add(vec3.create(), center, vec3.add(vec3.create(), vec3.scale(vec3.create(), axisX, planeOffset), vec3.scale(vec3.create(), axisY, planeOffset + planeSize)))
                )
                distXZ = this.distToTriangle(cameraPos, rayDir,
                    vec3.add(vec3.create(), center, vec3.add(vec3.create(), vec3.scale(vec3.create(), axisX, planeOffset), vec3.scale(vec3.create(), axisZ, planeOffset))),
                    vec3.add(vec3.create(), center, vec3.add(vec3.create(), vec3.scale(vec3.create(), axisX, planeOffset + planeSize), vec3.scale(vec3.create(), axisZ, planeOffset))),
                    vec3.add(vec3.create(), center, vec3.add(vec3.create(), vec3.scale(vec3.create(), axisX, planeOffset), vec3.scale(vec3.create(), axisZ, planeOffset + planeSize)))
                )
                distYZ = this.distToTriangle(cameraPos, rayDir,
                    vec3.add(vec3.create(), center, vec3.add(vec3.create(), vec3.scale(vec3.create(), axisY, planeOffset), vec3.scale(vec3.create(), axisZ, planeOffset))),
                    vec3.add(vec3.create(), center, vec3.add(vec3.create(), vec3.scale(vec3.create(), axisY, planeOffset + planeSize), vec3.scale(vec3.create(), axisZ, planeOffset))),
                    vec3.add(vec3.create(), center, vec3.add(vec3.create(), vec3.scale(vec3.create(), axisY, planeOffset), vec3.scale(vec3.create(), axisZ, planeOffset + planeSize)))
                )
            }

            if (distXY < minDist) { minDist = distXY; hitAxis = 'xy' }
            if (distXZ < minDist) { minDist = distXZ; hitAxis = 'xz' }
            if (distYZ < minDist) { minDist = distYZ; hitAxis = 'yz' }

            return hitAxis
        } else if (mode === 'rotate') {
            // Ray-Plane intersection for circles? Or just distance to ring?
            // Distance to ring is better.
            const r = axisLen * 0.5 // SYNC: must match render rotate radius above

            // X-Axis Ring (YZ Plane)
            const distX = this.distToRing(cameraPos, rayDir, center, axisX, r)
            // Y-Axis Ring (XZ Plane)
            const distY = this.distToRing(cameraPos, rayDir, center, axisY, r)
            // Z-Axis Ring (XY Plane)
            const distZ = this.distToRing(cameraPos, rayDir, center, axisZ, r)

            let minDist = ringHitThreshold
            let hitAxis: GizmoAxis = null

            if (distX < minDist) { minDist = distX; hitAxis = 'x' }
            if (distY < minDist) { minDist = distY; hitAxis = 'y' }
            if (distZ < minDist) { minDist = distZ; hitAxis = 'z' }

            return hitAxis
        }

        return null
    }

    private distToRing(rayOrigin: vec3, rayDir: vec3, center: vec3, normal: vec3, radius: number): number {
        // 1. Intersect ray with plane
        const denom = vec3.dot(normal, rayDir)
        if (Math.abs(denom) < 0.0001) return Infinity // Parallel

        const p0l0 = vec3.create(); vec3.sub(p0l0, center, rayOrigin)
        const t = vec3.dot(p0l0, normal) / denom
        if (t < 0) return Infinity // Behind camera

        const hitPoint = vec3.create(); vec3.scaleAndAdd(hitPoint, rayOrigin, rayDir, t)

        // 2. Check distance from center
        const dist = vec3.distance(hitPoint, center)

        // 3. Return distance to the circle edge (abs(dist - radius))
        return Math.abs(dist - radius)
    }

    private distToPoint(rayOrigin: vec3, rayDir: vec3, point: vec3): number {
        const toPoint = vec3.create()
        vec3.sub(toPoint, point, rayOrigin)
        const t = vec3.dot(toPoint, rayDir)
        if (t < 0) return Infinity
        const closest = vec3.create()
        vec3.scaleAndAdd(closest, rayOrigin, rayDir, t)
        return vec3.distance(point, closest)
    }

    // Distance between a ray (origin, dir) and a line segment (p1, p2)
    private distToSegment(rayOrigin: vec3, rayDir: vec3, p1: vec3, p2: vec3): number {
        // This is a bit complex 3D math. 
        // Simplified approach: Find closest point on ray to the segment line, then check if it's within segment bounds.

        const u = vec3.create(); vec3.sub(u, p2, p1)
        const v = vec3.create(); vec3.copy(v, rayDir)
        const w = vec3.create(); vec3.sub(w, p1, rayOrigin)

        const a = vec3.dot(u, u)
        const b = vec3.dot(u, v)
        const c = vec3.dot(v, v)
        const d = vec3.dot(u, w)
        const e = vec3.dot(v, w)
        const D = a * c - b * b

        let sc, tc

        if (D < 0.000001) { // Parallel
            sc = 0.0
            tc = (b > c ? d / b : e / c)
        } else {
            sc = (b * e - c * d) / D
            tc = (a * e - b * d) / D
        }

        // Clamp sc to segment [0, 1]
        // But wait, the closest point on the lines might be far.
        // We need the distance between the two closest points on the infinite lines, 
        // AND check if the point on the segment line is within p1-p2.

        // Let's use a simpler "distance from point to line" if we assume the ray passes close enough.
        // But raycasting is about finding if the ray *intersects* the volume.

        // Alternative: Project segment onto screen and do 2D distance check?
        // That requires View/Proj matrices. 
        // Since we have ray in world space, let's stick to world space.

        // Correct algorithm for dist between segment and ray:
        // 1. Find closest points on infinite lines.
        // 2. Clamp segment point to [0, 1].
        // 3. Recalculate distance.

        // Re-eval sc (s on segment)
        let sN, sD = D
        let tN, tD = D

        if (D < 0.000001) {
            sN = 0.0
            sD = 1.0
            tN = e
            tD = c
        } else {
            sN = (b * e - c * d)
            tN = (a * e - b * d)
            if (sN < 0.0) {
                sN = 0.0
                tN = e
                tD = c
            } else if (sN > sD) {
                sN = sD
                tN = e + b
                tD = c
            }
        }

        sc = (Math.abs(sN) < 0.000001 ? 0.0 : sN / sD)
        tc = (Math.abs(tN) < 0.000001 ? 0.0 : tN / tD)

        const dP = vec3.create()
        const temp1 = vec3.create(); vec3.scale(temp1, u, sc)
        const temp2 = vec3.create(); vec3.scale(temp2, v, tc)

        // dP = w + (sc * u) - (tc * v)
        vec3.add(dP, w, temp1)
        vec3.sub(dP, dP, temp2)

        return vec3.length(dP)
    }


    private distToQuad(rayOrigin: vec3, rayDir: vec3, p1: vec3, p2: vec3, _p3: vec3, p4: vec3): number {
        // 1. Intersect with plane defined by p1, p2, p4
        const edge1 = vec3.create(); vec3.sub(edge1, p2, p1)
        const edge2 = vec3.create(); vec3.sub(edge2, p4, p1)
        const normal = vec3.create(); vec3.cross(normal, edge1, edge2)
        vec3.normalize(normal, normal)

        const denom = vec3.dot(normal, rayDir)
        if (Math.abs(denom) < 0.0001) return Infinity

        const p0l0 = vec3.create(); vec3.sub(p0l0, p1, rayOrigin)
        const t = vec3.dot(p0l0, normal) / denom
        if (t < 0) return Infinity

        const hitPoint = vec3.create(); vec3.scaleAndAdd(hitPoint, rayOrigin, rayDir, t)

        // 2. Check if point is inside quad
        // Project hitPoint onto edge vectors to check bounds
        const v = vec3.create(); vec3.sub(v, hitPoint, p1)
        const dot1 = vec3.dot(v, edge1)
        const dot2 = vec3.dot(v, edge2)

        const len1 = vec3.dot(edge1, edge1)
        const len2 = vec3.dot(edge2, edge2)

        if (dot1 >= 0 && dot1 <= len1 && dot2 >= 0 && dot2 <= len2) {
            return 0.0 // Hit! Return 0 distance to ensure it's picked up if within threshold
        }

        return Infinity
    }

    private distToTriangle(rayOrigin: vec3, rayDir: vec3, p1: vec3, p2: vec3, p3: vec3): number {
        // Moller–Trumbore ray/triangle intersection
        const edge1 = vec3.create(); vec3.sub(edge1, p2, p1)
        const edge2 = vec3.create(); vec3.sub(edge2, p3, p1)
        const h = vec3.create(); vec3.cross(h, rayDir, edge2)
        const a = vec3.dot(edge1, h)
        if (Math.abs(a) < 0.000001) return Infinity

        const f = 1.0 / a
        const s = vec3.create(); vec3.sub(s, rayOrigin, p1)
        const u = f * vec3.dot(s, h)
        if (u < 0.0 || u > 1.0) return Infinity

        const q = vec3.create(); vec3.cross(q, s, edge1)
        const v = f * vec3.dot(rayDir, q)
        if (v < 0.0 || u + v > 1.0) return Infinity

        const t = f * vec3.dot(edge2, q)
        if (t < 0) return Infinity

        return 0.0
    }
}
