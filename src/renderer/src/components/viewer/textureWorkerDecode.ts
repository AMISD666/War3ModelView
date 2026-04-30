import { TextureAdjustments } from '../../utils/textureAdjustments'
import { DecodeTextureOptions, decodeTextureData } from './textureDecoder'
import { toTightArrayBuffer } from './textureBufferUtils'

export type WorkerLike = {
    addEventListener: (type: 'message', listener: (event: any) => void) => void
    removeEventListener: (type: 'message', listener: (event: any) => void) => void
    postMessage: (message: any, transferOrOptions?: Transferable[] | StructuredSerializeOptions) => void
    terminate?: () => void
}

export type DecodedTextureImage = ImageData | ImageBitmap

interface WorkerRpcState {
    pendingSingle: Map<string, (image: DecodedTextureImage | null) => void>
    pendingBatch: Map<string, (result: WorkerBatchResultMap | null) => void>
    listener: (event: any) => void
}

interface WorkerBatchDecodeTask {
    id: string
    path: string
    bytes: Uint8Array
    maxDimension?: number
    preferBlpBaseMip: boolean
    adjustments?: TextureAdjustments
}

interface WorkerBatchResultMap {
    decoded: Map<string, DecodedTextureImage>
    failedPaths: Set<string>
}

const workerRpcMap = new WeakMap<WorkerLike, WorkerRpcState>()
let decodeRequestCounter = 0

export function normalizeWorkers(worker?: WorkerLike | WorkerLike[]): WorkerLike[] {
    if (!worker) return []
    return Array.isArray(worker) ? worker.filter(Boolean) : [worker]
}

function ensureWorkerRpcState(worker: WorkerLike): WorkerRpcState {
    const cached = workerRpcMap.get(worker)
    if (cached) return cached

    const pendingSingle = new Map<string, (image: DecodedTextureImage | null) => void>()
    const pendingBatch = new Map<string, (result: WorkerBatchResultMap | null) => void>()
    const listener = (event: any) => {
        const type = event?.data?.type
        const payload = event?.data?.payload
        const id = payload?.id

        if (type === 'DECODE_BATCH_SUCCESS') {
            if (!id || !pendingBatch.has(id)) return
            const resolve = pendingBatch.get(id)!
            pendingBatch.delete(id)

            const decoded = new Map<string, DecodedTextureImage>()
            const failedPaths = new Set<string>()
            const resultList = Array.isArray(payload?.results) ? payload.results : []
            const errorList = Array.isArray(payload?.errors) ? payload.errors : []

            for (const item of resultList) {
                if (item?.path && item?.bitmap) {
                    decoded.set(item.path, item.bitmap as DecodedTextureImage)
                }
            }
            for (const item of errorList) {
                if (item?.path) {
                    failedPaths.add(item.path)
                }
            }

            resolve({ decoded, failedPaths })
            return
        }

        if (!id) return

        if (type === 'DECODE_SUCCESS' && pendingSingle.has(id)) {
            const resolve = pendingSingle.get(id)!
            pendingSingle.delete(id)
            resolve(payload.bitmap ?? null)
            return
        }

        if (type === 'ERROR') {
            if (pendingSingle.has(id)) {
                const resolve = pendingSingle.get(id)!
                pendingSingle.delete(id)
                resolve(null)
                return
            }
            if (pendingBatch.has(id)) {
                const resolve = pendingBatch.get(id)!
                pendingBatch.delete(id)
                resolve(null)
            }
        }
    }

    worker.addEventListener('message', listener)
    const state: WorkerRpcState = { pendingSingle, pendingBatch, listener }
    workerRpcMap.set(worker, state)
    return state
}

async function decodeBatchChunkWithWorker(
    worker: WorkerLike,
    tasks: WorkerBatchDecodeTask[]
): Promise<WorkerBatchResultMap | null> {
    if (tasks.length === 0) return { decoded: new Map(), failedPaths: new Set() }

    const rpc = ensureWorkerRpcState(worker)
    const id = `decode_batch_${++decodeRequestCounter}`
    const transfer: Transferable[] = []
    const payloadTasks = tasks.map((task) => {
        const tightBuffer = toTightArrayBuffer(task.bytes)
        transfer.push(tightBuffer)
        return {
            id: task.id,
            path: task.path,
            buffer: tightBuffer,
            maxDimension: task.maxDimension,
            preferBlpBaseMip: task.preferBlpBaseMip,
            adjustments: task.adjustments
        }
    })

    return await new Promise((resolve) => {
        const timeoutMs = Math.max(12000, 2500 * tasks.length)
        const timer = setTimeout(() => {
            rpc.pendingBatch.delete(id)
            resolve(null)
        }, timeoutMs)

        rpc.pendingBatch.set(id, (result) => {
            clearTimeout(timer)
            resolve(result)
        })

        worker.postMessage({
            type: 'DECODE_TEXTURE_BATCH',
            payload: {
                id,
                tasks: payloadTasks
            }
        }, transfer)
    })
}

function buildWorkerTaskQueues(
    tasks: WorkerBatchDecodeTask[],
    workerCount: number
): WorkerBatchDecodeTask[][] {
    const queues = Array.from({ length: workerCount }, () => [] as WorkerBatchDecodeTask[])
    const workerLoadBytes = Array.from({ length: workerCount }, () => 0)
    const sorted = [...tasks].sort((a, b) => b.bytes.byteLength - a.bytes.byteLength)

    for (const task of sorted) {
        let targetWorker = 0
        let minLoad = workerLoadBytes[0]
        for (let i = 1; i < workerLoadBytes.length; i++) {
            if (workerLoadBytes[i] < minLoad) {
                minLoad = workerLoadBytes[i]
                targetWorker = i
            }
        }
        queues[targetWorker].push(task)
        workerLoadBytes[targetWorker] += task.bytes.byteLength
    }

    return queues
}

function splitWorkerTaskChunks(
    queue: WorkerBatchDecodeTask[],
    maxChunkItems: number,
    maxChunkBytes: number
): WorkerBatchDecodeTask[][] {
    if (queue.length === 0) return []

    const chunks: WorkerBatchDecodeTask[][] = []
    let current: WorkerBatchDecodeTask[] = []
    let currentBytes = 0

    for (const task of queue) {
        const taskBytes = task.bytes.byteLength
        const shouldStartNewChunk =
            current.length > 0 &&
            (current.length >= maxChunkItems || currentBytes + taskBytes > maxChunkBytes)

        if (shouldStartNewChunk) {
            chunks.push(current)
            current = []
            currentBytes = 0
        }

        current.push(task)
        currentBytes += taskBytes
    }

    if (current.length > 0) {
        chunks.push(current)
    }

    return chunks
}

export async function decodeBatchWithWorkerPool(
    entries: Array<[string, Uint8Array]>,
    workers: WorkerLike[],
    textureOptionsByPath: Map<string, DecodeTextureOptions>,
    maxDimension?: number
): Promise<Map<string, DecodedTextureImage>> {
    const decoded = new Map<string, DecodedTextureImage>()
    if (entries.length === 0 || workers.length === 0) {
        return decoded
    }

    const workerEligibleTasks: WorkerBatchDecodeTask[] = []
    const workerByteMap = new Map<string, Uint8Array>()

    for (const [path, bytes] of entries) {
        const textureOptions = textureOptionsByPath.get(path)
        workerByteMap.set(path, bytes)
        workerEligibleTasks.push({
            id: `task_${++decodeRequestCounter}`,
            path,
            bytes,
            maxDimension,
            preferBlpBaseMip: !!textureOptions?.preferBlpBaseMip,
            adjustments: textureOptions?.adjustments
        })
    }

    const workerChunkMaxItems = 8
    const workerChunkMaxBytes = 12 * 1024 * 1024
    const failedPaths = new Set<string>()

    if (workerEligibleTasks.length > 0) {
        const queues = buildWorkerTaskQueues(workerEligibleTasks, workers.length)

        await Promise.all(workers.map(async (worker, workerIndex) => {
            const chunks = splitWorkerTaskChunks(
                queues[workerIndex],
                workerChunkMaxItems,
                workerChunkMaxBytes
            )
            for (const chunk of chunks) {
                const chunkResult = await decodeBatchChunkWithWorker(worker, chunk)
                if (!chunkResult) {
                    chunk.forEach((task) => failedPaths.add(task.path))
                    continue
                }
                chunkResult.decoded.forEach((image, path) => decoded.set(path, image))
                chunk.forEach((task) => {
                    if (!chunkResult.decoded.has(task.path) || chunkResult.failedPaths.has(task.path)) {
                        failedPaths.add(task.path)
                    }
                })
            }
        }))
    }

    let fallbackDecodeCount = 0
    let fallbackBatchStart = performance.now()
    for (const path of failedPaths) {
        const bytes = workerByteMap.get(path) || entries.find(([entryPath]) => entryPath === path)?.[1]
        if (!bytes) continue
        const imageData = decodeTextureData(toTightArrayBuffer(bytes), path, textureOptionsByPath.get(path))
        if (imageData) {
            decoded.set(path, imageData)
        }
        fallbackDecodeCount += 1
        if (fallbackDecodeCount >= 2 || performance.now() - fallbackBatchStart >= 8) {
            fallbackDecodeCount = 0
            await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
            fallbackBatchStart = performance.now()
        }
    }

    return decoded
}
