import { windowGateway, type ManagedWindow, type WindowGateway } from '../../infrastructure/window'
import { isKeyframeAnimVectorIntTrack, serializeAnimVectorForKeyframeIpc } from '../../utils/animVectorIpc'
import { markStandalonePerf } from '../../utils/standalonePerf'
import { chooseRpcEmitEncoding } from '../../utils/rpcSerialization'

const RPC_INVOKE_EMIT_THRESHOLD_CHARS = 48 * 1024

export type ResolveManagedWindow = (windowId: string) => Promise<ManagedWindow | null>

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value)

const hasAnimVectorKeys = (value: unknown): value is { Keys: unknown[] } =>
    isRecord(value) && Array.isArray(value.Keys)

const isLikelyLargeRpcPayload = (payload: unknown): boolean => {
    if (!isRecord(payload)) return false
    if (payload.modelData != null) return true
    if (Array.isArray(payload.materials) && payload.materials.length > 0) return true
    if (Array.isArray(payload.Materials) && payload.Materials.length > 0) return true
    if (Array.isArray(payload.textures) && payload.textures.length > 3) return true
    if (Array.isArray(payload.Textures) && payload.Textures.length > 3) return true
    if (Array.isArray(payload.geosets) && payload.geosets.length > 0) return true
    if (Array.isArray(payload.Geosets) && payload.Geosets.length > 0) return true
    if (typeof payload.snapshotVersion === 'number') return true
    return Object.keys(payload).length > 12
}

const toKeyframeIpcPayload = (payload: unknown): unknown => {
    if (!isRecord(payload) || !hasAnimVectorKeys(payload.initialData)) {
        return payload
    }

    const fieldName = typeof payload.fieldName === 'string' ? payload.fieldName : undefined
    return {
        ...payload,
        initialData: undefined,
        initialDataJson: serializeAnimVectorForKeyframeIpc(payload.initialData, {
            isInt: isKeyframeAnimVectorIntTrack(fieldName),
        }),
    }
}

export class WindowRpcTransport {
    constructor(
        private readonly resolveWindow: ResolveManagedWindow,
        private readonly gateway: WindowGateway = windowGateway,
    ) {}

    async emitToolWindowEvent(windowId: string, eventName: string, payload: unknown): Promise<void> {
        if (isLikelyLargeRpcPayload(payload)) {
            try {
                const choice = chooseRpcEmitEncoding(payload)
                if (choice.mode === 'msgpack' && choice.msgpackB64) {
                    await this.gateway.emitMsgpackPayload(windowId, eventName, choice.msgpackB64)
                    markStandalonePerf('invoke_emit_msgpack', {
                        windowId,
                        eventName,
                        b64Chars: choice.msgpackB64.length,
                    })
                    return
                }

                const json = choice.json ?? JSON.stringify(payload)
                if (json.length >= RPC_INVOKE_EMIT_THRESHOLD_CHARS) {
                    await this.gateway.emitJsonPayload(windowId, eventName, json)
                    markStandalonePerf('invoke_emit_large_payload', {
                        windowId,
                        eventName,
                        chars: json.length,
                    })
                    return
                }
            } catch (error) {
                console.warn('[WindowRpcTransport] Large payload gateway emit failed, falling back to window emit:', error)
            }
        }

        const win = await this.resolveWindow(windowId)
        if (!win) {
            markStandalonePerf('global_emit_fallback', { windowId, eventName, reason: 'window_not_found' })
            await this.gateway.emit(eventName, payload).catch(() => {})
            return
        }

        try {
            await win.emit(eventName, payload)
            markStandalonePerf('direct_window_emit', { windowId, eventName })
        } catch {
            markStandalonePerf('global_emit_fallback', { windowId, eventName, reason: 'direct_emit_failed' })
            await this.gateway.emit(eventName, payload).catch(() => {})
        }
    }

    emitToolWindowSync(windowId: string, state: unknown): Promise<void> {
        return this.emitToolWindowEvent(windowId, `rpc-sync-${windowId}`, state)
    }

    emitToolWindowPatch(windowId: string, patch: unknown): Promise<void> {
        return this.emitToolWindowEvent(windowId, `rpc-patch-${windowId}`, patch)
    }

    async emitKeyframeInit(windowId: string, payload: unknown): Promise<void> {
        const ipcPayload = toKeyframeIpcPayload(payload)
        const payloadJson = JSON.stringify(ipcPayload)
        let gatewayEmitOk = false

        for (const delay of [0, 50, 150]) {
            if (delay > 0) {
                await new Promise((resolve) => setTimeout(resolve, delay))
            }
            try {
                await this.gateway.emitJsonPayload(windowId, 'IPC_KEYFRAME_INIT', payloadJson)
                gatewayEmitOk = true
                break
            } catch (error) {
                console.warn('[WindowRpcTransport] Keyframe init gateway emit failed, will retry:', error)
            }
        }

        if (!gatewayEmitOk) {
            console.warn('[WindowRpcTransport] Keyframe init gateway emit failed repeatedly, falling back to window emit')
            await this.emitToolWindowEvent(windowId, 'IPC_KEYFRAME_INIT', ipcPayload).catch(() => {})
        }
    }
}
