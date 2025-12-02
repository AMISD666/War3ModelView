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

    // Gizmo Geometry Data
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
        highlightAxis: GizmoAxis
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

        // Colors
        const red = highlightAxis === 'x' ? [1, 1, 0] : [1, 0, 0]
        const green = highlightAxis === 'y' ? [1, 1, 0] : [0, 1, 0]
        const blue = highlightAxis === 'z' ? [1, 1, 0] : [0, 0, 1]

        if (mode === 'translate') {
            const xEnd = vec3.create(); vec3.add(xEnd, center, [this.axisLength, 0, 0])
            const yEnd = vec3.create(); vec3.add(yEnd, center, [0, this.axisLength, 0])
            const zEnd = vec3.create(); vec3.add(zEnd, center, [0, 0, this.axisLength])

            addLine(center, xEnd, red)
            addLine(center, yEnd, green)
            addLine(center, zEnd, blue)
        } else if (mode === 'scale') {
            const xEnd = vec3.create(); vec3.add(xEnd, center, [this.axisLength, 0, 0])
            const yEnd = vec3.create(); vec3.add(yEnd, center, [0, this.axisLength, 0])
            const zEnd = vec3.create(); vec3.add(zEnd, center, [0, 0, this.axisLength])

            addLine(center, xEnd, red)
            addLine(center, yEnd, green)
            addLine(center, zEnd, blue)

            // Add scale tips (small triangles/lines connecting axes?)
            // For now, just lines is fine, maybe add a small cross at the end?
            // Let's add a small perpendicular line at the end to denote scale
            const s = 5.0
            addLine(xEnd, [xEnd[0], xEnd[1] + s, xEnd[2]], red)
            addLine(yEnd, [yEnd[0] + s, yEnd[1], yEnd[2]], green)
            addLine(zEnd, [zEnd[0], zEnd[1], zEnd[2] + s], blue)
        } else if (mode === 'rotate') {
            // Draw circles
            const segments = 32
            const r = this.axisLength

            // X-Axis Circle (YZ plane)
            for (let i = 0; i < segments; i++) {
                const theta1 = (i / segments) * Math.PI * 2
                const theta2 = ((i + 1) / segments) * Math.PI * 2
                const p1 = vec3.fromValues(center[0], center[1] + Math.cos(theta1) * r, center[2] + Math.sin(theta1) * r)
                const p2 = vec3.fromValues(center[0], center[1] + Math.cos(theta2) * r, center[2] + Math.sin(theta2) * r)
                addLine(p1, p2, red)
            }

            // Y-Axis Circle (XZ plane)
            for (let i = 0; i < segments; i++) {
                const theta1 = (i / segments) * Math.PI * 2
                const theta2 = ((i + 1) / segments) * Math.PI * 2
                const p1 = vec3.fromValues(center[0] + Math.cos(theta1) * r, center[1], center[2] + Math.sin(theta1) * r)
                const p2 = vec3.fromValues(center[0] + Math.cos(theta2) * r, center[1], center[2] + Math.sin(theta2) * r)
                addLine(p1, p2, green)
            }

            // Z-Axis Circle (XY plane)
            for (let i = 0; i < segments; i++) {
                const theta1 = (i / segments) * Math.PI * 2
                const theta2 = ((i + 1) / segments) * Math.PI * 2
                const p1 = vec3.fromValues(center[0] + Math.cos(theta1) * r, center[1] + Math.sin(theta1) * r, center[2])
                const p2 = vec3.fromValues(center[0] + Math.cos(theta2) * r, center[1] + Math.sin(theta2) * r, center[2])
                addLine(p1, p2, blue)
            }
        }

        // Planar Handles (Squares)
        const planeSize = this.axisLength * 0.3
        const planeOffset = this.axisLength * 0.1 // Slight offset from origin

        // XY Plane (Blue)
        if (mode === 'translate' || mode === 'scale') {
            const p1 = vec3.create(); vec3.add(p1, center, [planeOffset, planeOffset, 0])
            const p2 = vec3.create(); vec3.add(p2, center, [planeOffset + planeSize, planeOffset, 0])
            const p3 = vec3.create(); vec3.add(p3, center, [planeOffset + planeSize, planeOffset + planeSize, 0])
            const p4 = vec3.create(); vec3.add(p4, center, [planeOffset, planeOffset + planeSize, 0])

            const color = highlightAxis === 'xy' ? [1, 1, 0] : [0, 0, 1]
            addLine(p1, p2, color)
            addLine(p2, p3, color)
            addLine(p3, p4, color)
            addLine(p4, p1, color)
            // Diagonals for fill effect
            addLine(p1, p3, color)
            addLine(p2, p4, color)
        }

        // XZ Plane (Green)
        if (mode === 'translate' || mode === 'scale') {
            const p1 = vec3.create(); vec3.add(p1, center, [planeOffset, 0, planeOffset])
            const p2 = vec3.create(); vec3.add(p2, center, [planeOffset + planeSize, 0, planeOffset])
            const p3 = vec3.create(); vec3.add(p3, center, [planeOffset + planeSize, 0, planeOffset + planeSize])
            const p4 = vec3.create(); vec3.add(p4, center, [planeOffset, 0, planeOffset + planeSize])

            const color = highlightAxis === 'xz' ? [1, 1, 0] : [0, 1, 0]
            addLine(p1, p2, color)
            addLine(p2, p3, color)
            addLine(p3, p4, color)
            addLine(p4, p1, color)
            addLine(p1, p3, color)
            addLine(p2, p4, color)
        }

        // YZ Plane (Red)
        if (mode === 'translate' || mode === 'scale') {
            const p1 = vec3.create(); vec3.add(p1, center, [0, planeOffset, planeOffset])
            const p2 = vec3.create(); vec3.add(p2, center, [0, planeOffset + planeSize, planeOffset])
            const p3 = vec3.create(); vec3.add(p3, center, [0, planeOffset + planeSize, planeOffset + planeSize])
            const p4 = vec3.create(); vec3.add(p4, center, [0, planeOffset, planeOffset + planeSize])

            const color = highlightAxis === 'yz' ? [1, 1, 0] : [1, 0, 0]
            addLine(p1, p2, color)
            addLine(p2, p3, color)
            addLine(p3, p4, color)
            addLine(p4, p1, color)
            addLine(p1, p3, color)
            addLine(p2, p4, color)
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
        mode: GizmoMode
    ): GizmoAxis {
        // Simplified ray-cylinder intersection (treating lines as cylinders/capsules)
        // For now, we use a distance check to the line segments

        const threshold = 2.0 // World unit threshold (might need adjustment based on camera distance)

        // We need to scale threshold by distance to camera to maintain constant screen size feel
        const distToGizmo = vec3.distance(cameraPos, center)
        const hitThreshold = threshold * (distToGizmo / 500.0) * 5.0

        if (mode === 'translate' || mode === 'scale') {
            const xEnd = vec3.create(); vec3.add(xEnd, center, [this.axisLength, 0, 0])
            const yEnd = vec3.create(); vec3.add(yEnd, center, [0, this.axisLength, 0])
            const zEnd = vec3.create(); vec3.add(zEnd, center, [0, 0, this.axisLength])

            const distX = this.distToSegment(cameraPos, rayDir, center, xEnd)
            const distY = this.distToSegment(cameraPos, rayDir, center, yEnd)
            const distZ = this.distToSegment(cameraPos, rayDir, center, zEnd)

            // Find closest hit
            let minDist = hitThreshold
            let hitAxis: GizmoAxis = null

            if (distX < minDist) { minDist = distX; hitAxis = 'x' }
            if (distY < minDist) { minDist = distY; hitAxis = 'y' }
            if (distZ < minDist) { minDist = distZ; hitAxis = 'z' }

            // Planar Checks
            const planeSize = this.axisLength * 0.3
            const planeOffset = this.axisLength * 0.1

            // XY Plane
            const distXY = this.distToQuad(cameraPos, rayDir,
                vec3.fromValues(center[0] + planeOffset, center[1] + planeOffset, center[2]),
                vec3.fromValues(center[0] + planeOffset + planeSize, center[1] + planeOffset, center[2]),
                vec3.fromValues(center[0] + planeOffset + planeSize, center[1] + planeOffset + planeSize, center[2]),
                vec3.fromValues(center[0] + planeOffset, center[1] + planeOffset + planeSize, center[2])
            )

            // XZ Plane
            const distXZ = this.distToQuad(cameraPos, rayDir,
                vec3.fromValues(center[0] + planeOffset, center[1], center[2] + planeOffset),
                vec3.fromValues(center[0] + planeOffset + planeSize, center[1], center[2] + planeOffset),
                vec3.fromValues(center[0] + planeOffset + planeSize, center[1], center[2] + planeOffset + planeSize),
                vec3.fromValues(center[0] + planeOffset, center[1], center[2] + planeOffset + planeSize)
            )

            // YZ Plane
            const distYZ = this.distToQuad(cameraPos, rayDir,
                vec3.fromValues(center[0], center[1] + planeOffset, center[2] + planeOffset),
                vec3.fromValues(center[0], center[1] + planeOffset + planeSize, center[2] + planeOffset),
                vec3.fromValues(center[0], center[1] + planeOffset + planeSize, center[2] + planeOffset + planeSize),
                vec3.fromValues(center[0], center[1] + planeOffset, center[2] + planeOffset + planeSize)
            )

            if (distXY < minDist) { minDist = distXY; hitAxis = 'xy' }
            if (distXZ < minDist) { minDist = distXZ; hitAxis = 'xz' }
            if (distYZ < minDist) { minDist = distYZ; hitAxis = 'yz' }

            return hitAxis
        } else if (mode === 'rotate') {
            // Ray-Plane intersection for circles? Or just distance to ring?
            // Distance to ring is better.
            const r = this.axisLength

            // X-Axis Ring (YZ Plane)
            const distX = this.distToRing(cameraPos, rayDir, center, [1, 0, 0], r)
            // Y-Axis Ring (XZ Plane)
            const distY = this.distToRing(cameraPos, rayDir, center, [0, 1, 0], r)
            // Z-Axis Ring (XY Plane)
            const distZ = this.distToRing(cameraPos, rayDir, center, [0, 0, 1], r)

            let minDist = hitThreshold
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
}
