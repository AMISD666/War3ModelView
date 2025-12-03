import { vec3, quat } from 'gl-matrix'

// Touch modes
const TOUCH_MODE_INVALID = -1
const TOUCH_MODE_ROTATE = 0
const TOUCH_MODE_ZOOM = 1

// Get the vector length between two touches
function getTouchesLength(touch1: Touch, touch2: Touch): number {
    const dx = touch2.clientX - touch1.clientX
    const dy = touch2.clientY - touch1.clientY
    return Math.sqrt(dx * dx + dy * dy)
}

const vecHeap = vec3.create()
const vecHeap2 = vec3.create()
const quatHeap = quat.create()

export interface MdxM3ViewerScene {
    camera: {
        moveToAndFace: (position: vec3, target: vec3, up: vec3) => void
        perspective: (fov: number, aspect: number, near: number, far: number) => void
        directionX: Float32Array
        directionY: Float32Array
    }
    viewport: [number, number, number, number]
}

export interface SimpleOrbitCameraOptions {
    moveSpeed?: number
    rotationSpeed?: number
    zoomFactor?: number
    horizontalAngle?: number
    verticalAngle?: number
    distance?: number
    position?: vec3
    target?: vec3
    twist?: number
    fov?: number
    nearClipPlane?: number
    farClipPlane?: number
    onManualChange?: () => void
}

/**
 * Orbit camera for mdx-m3-viewer
 * Based on VSCode plugin's camera.js
 */
export class SimpleOrbitCamera {
    scene: MdxM3ViewerScene
    canvas: HTMLCanvasElement
    camera: MdxM3ViewerScene['camera']

    // Movement per pixel of movement
    moveSpeed: number
    // Rotation in radians per pixel of movement
    rotationSpeed: number
    // Zoom factor per scroll
    zoomFactor: number

    horizontalAngle: number
    verticalAngle: number
    distance: number
    position: vec3
    target: vec3
    twist: number

    // Mouse state
    mouse: {
        buttons: [boolean, boolean, boolean]
        x: number
        y: number
        x2: number
        y2: number
    }

    // Touch state
    touchMode: number
    touches: Touch[]

    instance: any
    onManualChange: (() => void) | null

    fov: number
    nearClipPlane: number
    farClipPlane: number

    constructor(scene: MdxM3ViewerScene, canvas: HTMLCanvasElement, options: SimpleOrbitCameraOptions = {}) {
        this.scene = scene
        this.canvas = canvas
        this.camera = scene.camera

        this.moveSpeed = options.moveSpeed || 2
        this.rotationSpeed = options.rotationSpeed || (Math.PI / 180)
        this.zoomFactor = options.zoomFactor || 0.1
        this.horizontalAngle = options.horizontalAngle || Math.PI / 2
        this.verticalAngle = options.verticalAngle || Math.PI / 4
        this.distance = options.distance || 500
        this.position = options.position || vec3.create()
        this.target = options.target || vec3.create()
        this.twist = options.twist || 0

        this.mouse = { buttons: [false, false, false], x: 0, y: 0, x2: 0, y2: 0 }
        this.touchMode = TOUCH_MODE_INVALID
        this.touches = []
        this.instance = null
        this.onManualChange = options.onManualChange || null
        this.fov = options.fov || Math.PI / 4
        this.nearClipPlane = options.nearClipPlane || 1
        this.farClipPlane = options.farClipPlane || 200000

        this.update()
        this.setupEventListeners()

        window.addEventListener('resize', () => this.onResize())
        setTimeout(() => this.onResize(), 0)
    }

    private setupEventListeners() {
        // Disable context menu
        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault())
        this.canvas.addEventListener('selectstart', (e) => e.preventDefault())

        // Mouse down
        this.canvas.addEventListener('mousedown', (e) => {
            e.preventDefault()
            this.mouse.buttons[e.button] = true
        })

        // Mouse up (on document to catch releases outside canvas)
        document.addEventListener('mouseup', (e) => {
            e.preventDefault()
            this.mouse.buttons[e.button] = false
        })

        // Mouse move
        window.addEventListener('mousemove', (e) => {
            this.mouse.x2 = this.mouse.x
            this.mouse.y2 = this.mouse.y
            this.mouse.x = e.clientX
            this.mouse.y = e.clientY

            const dx = this.mouse.x - this.mouse.x2
            const dy = this.mouse.y - this.mouse.y2

            if (this.mouse.buttons[0]) {
                this.rotate(dx, dy)
            }

            if (this.mouse.buttons[2]) {
                this.move(-dx, dy)
            }
        })

        // Mouse wheel
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault()

            let deltaY = e.deltaY

            if (e.deltaMode === 1) {
                deltaY = deltaY / 3 * 100
            }

            this.zoom(deltaY / 100)
        })

        // Touch events
        this.canvas.addEventListener('touchstart', (e) => {
            e.preventDefault()
            const targetTouches = e.targetTouches

            if (targetTouches.length === 1) {
                this.touchMode = TOUCH_MODE_ROTATE
            } else if (targetTouches.length === 2) {
                this.touchMode = TOUCH_MODE_ZOOM
            } else {
                this.touchMode = TOUCH_MODE_INVALID
            }

            this.touches.length = 0
            this.touches.push(...Array.from(targetTouches))
        })

        this.canvas.addEventListener('touchend', (e) => {
            e.preventDefault()
            this.touchMode = TOUCH_MODE_INVALID
        })

        this.canvas.addEventListener('touchcancel', (e) => {
            e.preventDefault()
            this.touchMode = TOUCH_MODE_INVALID
        })

        this.canvas.addEventListener('touchmove', (e) => {
            e.preventDefault()
            const targetTouches = e.targetTouches

            if (this.touchMode === TOUCH_MODE_ROTATE) {
                const oldTouch = this.touches[0]
                const newTouch = targetTouches[0]
                const dx = newTouch.clientX - oldTouch.clientX
                const dy = newTouch.clientY - oldTouch.clientY

                this.rotate(dx, dy)
            } else if (this.touchMode === TOUCH_MODE_ZOOM) {
                const len1 = getTouchesLength(this.touches[0], this.touches[1])
                const len2 = getTouchesLength(targetTouches[0], targetTouches[1])

                this.zoom((len1 - len2) / 50)
            }

            this.touches.length = 0
            this.touches.push(...Array.from(targetTouches))
        })
    }

    update() {
        // For now, just update the internal camera
        // Instance camera support can be added later if needed
        this.updateInternalCamera()
    }

    // Move the camera and target on the XY plane
    move(x: number, y: number) {
        const dirX = this.camera.directionX
        const dirY = this.camera.directionY
        const w = this.canvas.width
        const h = this.canvas.height
        const aspect = w / h

        const sw = (x / w) * this.distance * aspect
        const sh = (y / h) * this.distance

        vec3.add(
            this.target,
            this.target,
            vec3.scale(vecHeap, vec3.normalize(vecHeap, vec3.set(vecHeap, dirX[0], dirX[1], 0)), sw)
        )
        vec3.add(
            this.target,
            this.target,
            vec3.scale(vecHeap, vec3.normalize(vecHeap, vec3.set(vecHeap, dirY[0], dirY[1], 0)), sh)
        )

        this.manualChange()
    }

    // Rotate the camera around the target
    rotate(x: number, y: number) {
        this.horizontalAngle -= x * this.rotationSpeed
        this.verticalAngle -= y * this.rotationSpeed

        this.manualChange()
    }

    // Zoom by changing distance from target
    zoom(factor: number) {
        this.distance = Math.max(1, this.distance * (1 + factor * this.zoomFactor))

        this.manualChange()
    }

    manualChange() {
        this.updateInternalCamera()

        if (this.instance) {
            this.instance = null

            if (this.onManualChange) {
                this.onManualChange()
            }
        }
    }

    // Resize canvas and update camera
    onResize() {
        const width = Math.max(this.canvas.clientWidth, 1)
        const height = Math.max(this.canvas.clientHeight, 1)

        this.canvas.width = width
        this.canvas.height = height

        this.scene.viewport[2] = width
        this.scene.viewport[3] = height

        this.camera.perspective(this.fov, width / height, this.nearClipPlane, this.farClipPlane)
    }

    moveToAndFace(position: vec3, target: vec3) {
        vec3.sub(vecHeap, position, target)

        const r = vec3.length(vecHeap)
        const theta = Math.atan2(vecHeap[1], vecHeap[0])
        const phi = Math.acos(vecHeap[2] / r)

        vec3.copy(this.target, target)

        this.verticalAngle = phi
        this.horizontalAngle = theta + Math.PI / 2
        this.distance = r

        this.updateInternalCamera()
    }

    updateInternalCamera() {
        // Limit vertical angle to avoid flips
        this.verticalAngle = Math.min(Math.max(0.01, this.verticalAngle), Math.PI - 0.01)

        quat.identity(quatHeap)
        quat.rotateZ(quatHeap, quatHeap, this.horizontalAngle)
        quat.rotateX(quatHeap, quatHeap, this.verticalAngle)

        vec3.set(this.position, 0, 0, 1)
        vec3.transformQuat(this.position, this.position, quatHeap)
        vec3.scale(this.position, this.position, this.distance)
        vec3.add(this.position, this.position, this.target)

        const twist = this.twist - Math.PI / 2
        vec3.set(vecHeap, 0, -Math.cos(twist), -Math.sin(twist))

        this.camera.moveToAndFace(this.position, this.target, vecHeap)
    }
}
