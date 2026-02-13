import React, { useEffect, useRef, useState } from 'react'
import { Alert, Spin } from 'antd'
import { emitTo, listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import TextureEditorModal from '../modals/TextureEditorModal'
import {
    DETACHED_TEXTURE_EDITOR_EVENTS,
    DetachedTextureDeltaOp,
    DetachedTextureEditorDeltaPayload,
    DetachedTextureEditorApplyPayload,
    DetachedTextureEditorSnapshot
} from '../../constants/detachedWindows'

const cloneTexture = (texture: any) => {
    if (texture === undefined || texture === null) return texture
    try {
        if (typeof structuredClone === 'function') {
            return structuredClone(texture)
        }
    } catch {
        // Fallback to JSON clone.
    }
    return JSON.parse(JSON.stringify(texture))
}

const applyDeltaOps = (source: any[], ops: DetachedTextureDeltaOp[]): any[] => {
    const next = Array.isArray(source) ? [...source] : []
    for (const op of ops) {
        if (typeof op?.index !== 'number' || op.index < 0) continue
        if (op.type === 'add') {
            next.splice(op.index, 0, cloneTexture(op.texture))
            continue
        }
        if (op.type === 'remove') {
            if (op.index < next.length) {
                next.splice(op.index, 1)
            }
            continue
        }
        if (op.type === 'update') {
            if (op.index < next.length) {
                next[op.index] = cloneTexture(op.texture)
            }
        }
    }
    return next
}

const TextureEditorDetachedWindow: React.FC = () => {
    const [snapshot, setSnapshot] = useState<DetachedTextureEditorSnapshot | null>(null)
    const [isReady, setIsReady] = useState(false)
    const latestRevisionRef = useRef(0)

    useEffect(() => {
        let mounted = true
        let unlistenSnapshot: (() => void) | null = null
        let unlistenDelta: (() => void) | null = null

        const setup = async () => {
            unlistenSnapshot = await listen<DetachedTextureEditorSnapshot>(
                DETACHED_TEXTURE_EDITOR_EVENTS.snapshot,
                (event) => {
                    if (!mounted) return
                    const revision = Number(event.payload?.revision || 0)
                    if (revision <= latestRevisionRef.current) return
                    latestRevisionRef.current = revision
                    setSnapshot({
                        textures: Array.isArray(event.payload?.textures) ? event.payload.textures : [],
                        modelPath: event.payload?.modelPath,
                        revision
                    })
                    setIsReady(true)
                }
            )

            unlistenDelta = await listen<DetachedTextureEditorDeltaPayload>(
                DETACHED_TEXTURE_EDITOR_EVENTS.delta,
                (event) => {
                    if (!mounted) return
                    const revision = Number(event.payload?.revision || 0)
                    if (revision <= latestRevisionRef.current) return
                    latestRevisionRef.current = revision
                    const ops = Array.isArray(event.payload?.ops) ? event.payload.ops : []
                    setSnapshot((current) => {
                        if (!current) return current
                        return {
                            textures: applyDeltaOps(current.textures, ops),
                            modelPath: event.payload?.modelPath ?? current.modelPath,
                            revision
                        }
                    })
                    setIsReady(true)
                }
            )

            await emitTo('main', DETACHED_TEXTURE_EDITOR_EVENTS.requestSnapshot)
        }

        setup().catch((error) => {
            console.error('[DetachedTextureEditor] setup failed:', error)
            if (mounted) setIsReady(true)
        })

        return () => {
            mounted = false
            unlistenSnapshot?.()
            unlistenDelta?.()
        }
    }, [])

    const handleApply = async (textures: any[]) => {
        const payload: DetachedTextureEditorApplyPayload = {
            textures: Array.isArray(textures) ? textures : []
        }
        await emitTo('main', DETACHED_TEXTURE_EDITOR_EVENTS.apply, payload)
    }

    const handleClose = async () => {
        try {
            await getCurrentWindow().close()
        } catch (error) {
            console.error('[DetachedTextureEditor] close failed:', error)
        }
    }

    if (!isReady) {
        return (
            <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#1f1f1f' }}>
                <Spin size="large" />
            </div>
        )
    }

    if (!snapshot) {
        return (
            <div style={{ height: '100vh', padding: 16, backgroundColor: '#1f1f1f' }}>
                <Alert type="warning" message="No snapshot from main window. Close and retry." showIcon />
            </div>
        )
    }

    return (
        <TextureEditorModal
            visible={true}
            onClose={handleClose}
            modelPath={snapshot.modelPath}
            initialTextures={snapshot.textures}
            onApply={handleApply}
            asWindow={true}
        />
    )
}

export default TextureEditorDetachedWindow
