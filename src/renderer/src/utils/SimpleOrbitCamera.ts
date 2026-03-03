import { vec3, mat4, quat } from 'gl-matrix'

export class SimpleOrbitCamera {
    private canvas: HTMLCanvasElement
    public moveSpeed: number
    public rotationSpeed: number
    public zoomFactor: number
    public horizontalAngle: number
    public verticalAngle: number
    public distance: number
    public position: vec3
    public target: vec3
    public twist: number
    public fov: number
    public nearClipPlane: number
    public farClipPlane: number

    // 投影模式：透视 或 正交
    public projectionMode: 'perspective' | 'orthographic' = 'perspective'
    // 正交模式下的可视范围（半高度）
    public orthoSize: number = 500

    private mouse: { buttons: boolean[]; x: number; y: number; x2: number; y2: number }

    // Callback for manual changes (to trigger React re-renders if needed)
    public onChange?: () => void

    public enabled: boolean = true

    // Store event listener references for cleanup
    private boundListeners: {
        contextMenu: (e: Event) => void
        selectStart: (e: Event) => void
        mouseDown: (e: MouseEvent) => void
        mouseUp: (e: MouseEvent) => void
        mouseMove: (e: MouseEvent) => void
        wheel: (e: WheelEvent) => void
    } | null = null

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas
        this.moveSpeed = 2
        this.rotationSpeed = Math.PI / 180
        this.zoomFactor = 0.1
        this.horizontalAngle = Math.PI / 2
        this.verticalAngle = Math.PI / 4
        this.distance = 500
        this.position = vec3.create()
        this.target = vec3.create()
        this.twist = 0
        this.fov = Math.PI / 4
        this.nearClipPlane = 1
        this.farClipPlane = 100000

        this.mouse = { buttons: [false, false, false], x: 0, y: 0, x2: 0, y2: 0 }

        this.initEvents()
        this.update()
    }

    private initEvents() {
        // Create bound listener functions to enable removal later
        this.boundListeners = {
            contextMenu: (e: Event) => e.preventDefault(),
            selectStart: (e: Event) => e.preventDefault(),
            mouseDown: (e: MouseEvent) => {
                if (!this.enabled) return
                // Block camera interaction if Ctrl is held (for picking)
                if (e.ctrlKey || e.metaKey) return

                e.preventDefault()
                this.mouse.buttons[e.button] = true
            },
            mouseUp: (e: MouseEvent) => {
                if (e.button < 3) this.mouse.buttons[e.button] = false
            },
            mouseMove: (e: MouseEvent) => {
                this.mouse.x2 = this.mouse.x
                this.mouse.y2 = this.mouse.y
                this.mouse.x = e.clientX
                this.mouse.y = e.clientY

                if (!this.enabled) return

                const dx = this.mouse.x - this.mouse.x2
                const dy = this.mouse.y - this.mouse.y2

                if (this.mouse.buttons[0]) {
                    this.rotate(dx, dy)
                }

                if (this.mouse.buttons[2]) {
                    this.move(-dx, dy)
                }
            },
            wheel: (e: WheelEvent) => {
                if (!this.enabled) return
                // Ctrl+Wheel is reserved for node size scaling (handled in Viewer.tsx)
                if (e.ctrlKey || e.metaKey) return
                e.preventDefault()
                let deltaY = e.deltaY
                if (e.deltaMode === 1) {
                    deltaY = (deltaY / 3) * 100
                }
                this.zoom(deltaY / 100)
            }
        }

        // Add event listeners
        this.canvas.addEventListener('contextmenu', this.boundListeners.contextMenu)
        this.canvas.addEventListener('selectstart', this.boundListeners.selectStart)
        this.canvas.addEventListener('mousedown', this.boundListeners.mouseDown)
        document.addEventListener('mouseup', this.boundListeners.mouseUp)
        window.addEventListener('mousemove', this.boundListeners.mouseMove)
        this.canvas.addEventListener('wheel', this.boundListeners.wheel)
    }

    /**
     * CRITICAL: Call this method when disposing of the camera to prevent event listener leaks.
     * This removes all event listeners that were added in the constructor.
     */
    public destroy() {
        if (this.boundListeners) {
            this.canvas.removeEventListener('contextmenu', this.boundListeners.contextMenu)
            this.canvas.removeEventListener('selectstart', this.boundListeners.selectStart)
            this.canvas.removeEventListener('mousedown', this.boundListeners.mouseDown)
            document.removeEventListener('mouseup', this.boundListeners.mouseUp)
            window.removeEventListener('mousemove', this.boundListeners.mouseMove)
            this.canvas.removeEventListener('wheel', this.boundListeners.wheel)
            this.boundListeners = null
        }
    }

    public update() {
        // Limit vertical angle
        this.verticalAngle = Math.min(Math.max(0.01, this.verticalAngle), Math.PI - 0.01)

        const quatHeap = quat.create()
        quat.identity(quatHeap)
        quat.rotateZ(quatHeap, quatHeap, this.horizontalAngle)
        quat.rotateX(quatHeap, quatHeap, this.verticalAngle)

        vec3.set(this.position, 0, 0, 1)
        vec3.transformQuat(this.position, this.position, quatHeap)
        vec3.scale(this.position, this.position, this.distance)
        vec3.add(this.position, this.position, this.target)

        if (this.onChange) this.onChange()
    }

    public move(x: number, y: number) {
        // Calculate direction vectors based on current rotation
        const quatHeap = quat.create()
        quat.identity(quatHeap)
        quat.rotateZ(quatHeap, quatHeap, this.horizontalAngle)
        quat.rotateX(quatHeap, quatHeap, this.verticalAngle)

        // Right vector (local X)
        const dirX = vec3.fromValues(1, 0, 0)
        vec3.transformQuat(dirX, dirX, quatHeap)

        // Up vector (local Y) - projected to screen plane
        const dirY = vec3.fromValues(0, 1, 0)
        vec3.transformQuat(dirY, dirY, quatHeap)

        const w = this.canvas.width
        const h = this.canvas.height
        const aspect = w / h

        // 正交模式使用 orthoSize，透视模式使用 distance
        const viewSize = this.projectionMode === 'orthographic' ? this.orthoSize : this.distance
        const sw = (x / w) * viewSize * aspect * 2
        const sh = (y / h) * viewSize * 2

        const vecHeap = vec3.create()

        // Move target along camera's right/up vectors
        vec3.scale(vecHeap, dirX, sw)
        vec3.add(this.target, this.target, vecHeap)

        vec3.scale(vecHeap, dirY, sh)
        vec3.add(this.target, this.target, vecHeap)

        this.update()
    }

    public rotate(x: number, y: number) {
        this.horizontalAngle -= x * this.rotationSpeed
        this.verticalAngle -= y * this.rotationSpeed
        this.update()
    }

    public zoom(factor: number) {
        if (this.projectionMode === 'orthographic') {
            // 正交模式：调整 orthoSize（允许非常近的缩放）
            this.orthoSize = Math.max(0.1, this.orthoSize * (1 + factor * this.zoomFactor))
        } else {
            // 透视模式：调整 distance
            this.distance = Math.max(1, this.distance * (1 + factor * this.zoomFactor))
        }
        this.update()
    }

    public getRotation(out: quat) {
        quat.identity(out)
        quat.rotateZ(out, out, this.horizontalAngle)
        quat.rotateX(out, out, this.verticalAngle)
    }

    public getMatrix(outView: mat4, outProjection: mat4) {
        // 视图矩阵
        mat4.lookAt(outView, this.position, this.target, [0, 0, 1])

        // 投影矩阵
        const aspect = this.canvas.width / this.canvas.height
        if (this.projectionMode === 'orthographic') {
            // 正交投影 - 使用更大的裁剪范围防止模型被裁剪
            const halfHeight = this.orthoSize
            const halfWidth = halfHeight * aspect
            // 正交模式使用对称的近远裁剪面，范围足够大
            // 根据 orthoSize 动态调整以防止裁剪
            const clipRange = Math.max(this.farClipPlane, this.orthoSize * 100)
            mat4.ortho(outProjection, -halfWidth, halfWidth, -halfHeight, halfHeight, -clipRange, clipRange)
        } else {
            // 透视投影 - 动态调整近裁剪面以保持深度精度
            // 近裁剪面设为距离的 0.1%，最小 0.1，最大 10
            const dynamicNear = Math.max(0.1, Math.min(10, this.distance * 0.001))
            // 远裁剪面设为距离的 1000 倍，但不小于默认值
            const dynamicFar = Math.max(this.farClipPlane, this.distance * 1000)
            mat4.perspective(outProjection, this.fov, aspect, dynamicNear, dynamicFar)
        }
    }

    /**
     * 设置为正交投影模式
     */
    public setOrthographic() {
        this.projectionMode = 'orthographic'
        // 根据当前 distance 计算初始 orthoSize
        this.orthoSize = this.distance * Math.tan(this.fov / 2)
        if (this.onChange) this.onChange()
    }

    /**
     * 设置为透视投影模式
     */
    public setPerspective() {
        this.projectionMode = 'perspective'
        // 根据当前 orthoSize 恢复 distance
        this.distance = this.orthoSize / Math.tan(this.fov / 2)
        if (this.onChange) this.onChange()
    }
}

