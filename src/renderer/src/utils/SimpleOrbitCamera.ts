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

        const sw = (x / w) * this.distance * aspect * 2
        const sh = (y / h) * this.distance * 2

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
        this.distance = Math.max(1, this.distance * (1 + factor * this.zoomFactor))
        this.update()
    }

    public getRotation(out: quat) {
        quat.identity(out)
        quat.rotateZ(out, out, this.horizontalAngle)
        quat.rotateX(out, out, this.verticalAngle)
    }

    public getMatrix(outView: mat4, outProjection: mat4) {
        // const twist = this.twist - Math.PI / 2
        // const up = vec3.fromValues(0, -Math.cos(twist), -Math.sin(twist))
        // For now, assume twist is 0, so UP is (0, 0, 1)

        mat4.lookAt(outView, this.position, this.target, [0, 0, 1])
        mat4.perspective(outProjection, this.fov, this.canvas.width / this.canvas.height, this.nearClipPlane, this.farClipPlane)
    }
}

