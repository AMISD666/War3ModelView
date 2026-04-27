import { useEffect, useState, useCallback, useRef, startTransition } from 'react';
import { debugLog } from '../utils/debugLog';
import { normalizeRpcSyncPayload } from '../utils/rpcSerialization';
import { markStandalonePerf } from '../utils/standalonePerf';
import { windowManager } from '../utils/WindowManager';
import { windowGateway } from '../infrastructure/window';
import { markSnapshotIgnoredStale, markSnapshotReceived, markSnapshotSent } from '../application/diagnostics';

const getPayloadKeyCount = (payload: unknown): number => {
    if (!payload || typeof payload !== 'object') return 0
    return Object.keys(payload as Record<string, unknown>).length
}

type WindowEventPayload<TPayload> = {
    payload: TPayload
}

type RpcCommandEnvelope = {
    command: string
    payload: unknown
}

type ActiveModelChangedPayload = {
    activeTabId: string | null
    modelPath: string
    hasModelData: boolean
}

type RevisionedRpcState = {
    documentId?: string | null
    documentRevision?: number
    snapshotRevision?: number
    snapshotVersion?: number
}

const getEventPayload = <TPayload,>(event: unknown): TPayload =>
    (event as WindowEventPayload<TPayload>).payload

const asRevisionedRpcState = (value: unknown): RevisionedRpcState | null => {
    if (!value || typeof value !== 'object') {
        return null
    }
    const candidate = value as RevisionedRpcState
    return typeof candidate.documentRevision === 'number' ? candidate : null
}

const shouldIgnoreStaleSnapshot = (previous: unknown, next: unknown): boolean => {
    const previousRevision = asRevisionedRpcState(previous)
    const nextRevision = asRevisionedRpcState(next)
    if (!previousRevision || !nextRevision) {
        return false
    }

    const previousDocumentId = previousRevision.documentId
    const nextDocumentId = nextRevision.documentId
    if (!previousDocumentId || !nextDocumentId || previousDocumentId !== nextDocumentId) {
        return false
    }

    if (nextRevision.documentRevision! < previousRevision.documentRevision!) {
        return true
    }

    const previousSnapshotRevision = previousRevision.snapshotRevision ?? previousRevision.snapshotVersion
    const nextSnapshotRevision = nextRevision.snapshotRevision ?? nextRevision.snapshotVersion
    return (
        nextRevision.documentRevision === previousRevision.documentRevision &&
        typeof previousSnapshotRevision === 'number' &&
        typeof nextSnapshotRevision === 'number' &&
        nextSnapshotRevision < previousSnapshotRevision
    )
}

const getRevisionPerfDetail = (value: unknown): Record<string, unknown> => {
    const revision = asRevisionedRpcState(value)
    if (!revision) {
        return {}
    }
    return {
        documentId: revision.documentId ?? '',
        documentRevision: revision.documentRevision ?? 0,
        snapshotRevision: revision.snapshotRevision ?? revision.snapshotVersion ?? 0,
        snapshotVersion: revision.snapshotVersion ?? 0,
    }
}

interface RpcClientOptions<TState, TPatch> {
    applyPatch?: (previousState: TState, patch: TPatch) => TState
}

/** 默认合并连续全量同步的间隔（毫秒）；略短以配合 invoke 大负载路径，独立窗口体感更跟手 */
export const RPC_DEFAULT_BROADCAST_DEBOUNCE_MS = 20

export type UseRpcServerOptions = {
    /**
     * 对 broadcastSync 做 trailing 防抖；0 表示每次立即发送（旧行为）。
     * rpc-req / rpc-ready / broadcastPatch 不受影响。
     */
    broadcastDebounceMs?: number
}

/**
 * useRpcServer - Hook for the MAIN window (data source)
 * @param windowId The identifier for the target window to sync with
 * @param getLatestState A getter function that returns the slice of state needed by the client
 * @param onCommand A callback to execute actual logic when the client window triggers an action
 */
export function useRpcServer<TState, TPatch = never>(
    windowId: string,
    getLatestState: () => TState,
    onCommand?: (command: string, payload: unknown) => void,
    options?: UseRpcServerOptions
) {
    const getLatestStateRef = useRef(getLatestState);
    const onCommandRef = useRef(onCommand);
    const debounceMs =
        options?.broadcastDebounceMs !== undefined
            ? options.broadcastDebounceMs
            : RPC_DEFAULT_BROADCAST_DEBOUNCE_MS
    const broadcastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const pendingBroadcastRef = useRef<TState | null>(null)

    useEffect(() => {
        getLatestStateRef.current = getLatestState;
        onCommandRef.current = onCommand;
    }, [getLatestState, onCommand]);

    useEffect(() => {
        let isMounted = true;
        let unsubscribeReq: (() => void) | undefined;
        let unsubscribeReady: (() => void) | undefined;
        let unsubscribeCmd: (() => void) | undefined;

        debugLog(`[RPC Server][${windowId}] Mounting server hook...`);

        windowGateway.listen(`rpc-req-${windowId}`, async () => {
            debugLog(`[RPC Server][${windowId}] Received request for sync from client.`);
            const state = getLatestStateRef.current();
            markSnapshotSent({
                windowId,
                source: 'request_response',
                keyCount: getPayloadKeyCount(state),
                ...getRevisionPerfDetail(state),
            });
            await windowManager.emitToolWindowSync(windowId, state);
        }).then(unlisten => {
            if (!isMounted) unlisten();
            else unsubscribeReq = unlisten;
        }).catch(console.error);

        windowGateway.listen(`rpc-ready-${windowId}`, async () => {
            debugLog(`[RPC Server][${windowId}] Child reported READY.`);
            const state = getLatestStateRef.current();
            markSnapshotSent({
                windowId,
                source: 'ready_signal',
                keyCount: getPayloadKeyCount(state),
                ...getRevisionPerfDetail(state),
            });
            await windowManager.emitToolWindowSync(windowId, state);
        }).then(unlisten => {
            if (!isMounted) unlisten();
            else unsubscribeReady = unlisten;
        }).catch(console.error);

        windowGateway.listen(`rpc-cmd-${windowId}`, (event) => {
            const payload = getEventPayload<RpcCommandEnvelope>(event)
            debugLog(`[RPC Server][${windowId}] Received command: ${payload.command}`);
            if (onCommandRef.current) {
                onCommandRef.current(payload.command, payload.payload);
            }
        }).then(unlisten => {
            if (!isMounted) unlisten();
            else unsubscribeCmd = unlisten;
        }).catch(e => debugLog(`[RPC Server] Cmd Listen Error: ${e}`));

        return () => {
            debugLog(`[RPC Server][${windowId}] Unmounting server hook.`);
            isMounted = false;
            if (unsubscribeReq) unsubscribeReq();
            if (unsubscribeReady) unsubscribeReady();
            if (unsubscribeCmd) unsubscribeCmd();
        }
    }, [windowId]);

    const flushPendingBroadcast = useCallback(() => {
        broadcastTimerRef.current = null
        const pending = pendingBroadcastRef.current
        if (pending === null) return
        pendingBroadcastRef.current = null
        debugLog(`[RPC Server][${windowId}] Flushing debounced broadcast. Object keys: ${Object.keys(pending as any).join(',')}`)
        markSnapshotSent({
            windowId,
            source: 'broadcast',
            keyCount: getPayloadKeyCount(pending),
            debounced: true,
            ...getRevisionPerfDetail(pending),
        })
        void windowManager.emitToolWindowSync(windowId, pending)
    }, [windowId])

    useEffect(() => {
        return () => {
            if (broadcastTimerRef.current !== null) {
                clearTimeout(broadcastTimerRef.current)
                broadcastTimerRef.current = null
            }
            if (pendingBroadcastRef.current !== null) {
                const pending = pendingBroadcastRef.current
                pendingBroadcastRef.current = null
                void windowManager.emitToolWindowSync(windowId, pending)
            }
        }
    }, [windowId])

    const broadcastSync = useCallback(
        (state: TState) => {
            debugLog(
                `[RPC Server][${windowId}] Queue broadcast state. Object keys: ${Object.keys(state as any).join(',')}`
            )
            pendingBroadcastRef.current = state

            if (debounceMs <= 0) {
                if (broadcastTimerRef.current !== null) {
                    clearTimeout(broadcastTimerRef.current)
                    broadcastTimerRef.current = null
                }
                flushPendingBroadcast()
                return
            }

            if (broadcastTimerRef.current !== null) {
                clearTimeout(broadcastTimerRef.current)
            }
            broadcastTimerRef.current = setTimeout(flushPendingBroadcast, debounceMs)
        },
        [windowId, debounceMs, flushPendingBroadcast]
    )

    const broadcastPatch = useCallback((patch: TPatch) => {
        markStandalonePerf('patch_sent', {
            windowId,
            keyCount: getPayloadKeyCount(patch),
        })
        void windowManager.emitToolWindowPatch(windowId, patch)
    }, [windowId])

    return { broadcastSync, broadcastPatch };
}

/**
 * useRpcClient - Hook for the SECONDARY isolated window (data receiver & command sender)
 * @param windowId The identifier of THIS window
 * @param initialState The default fallback state
 */
export function useRpcClient<TState, TPatch = never>(
    windowId: string,
    initialState: TState,
    options?: RpcClientOptions<TState, TPatch>
) {
    const [state, setState] = useState<TState>(initialState);
    const bootstrapRequestedRef = useRef(false);
    const pendingSnapshotIdRef = useRef<number | null>(null);
    const receivedSnapshotCounterRef = useRef(0);
    const applyPatchRef = useRef(options?.applyPatch);

    useEffect(() => {
        applyPatchRef.current = options?.applyPatch
    }, [options?.applyPatch])

    useEffect(() => {
        if (pendingSnapshotIdRef.current === null) return;

        const snapshotId = pendingSnapshotIdRef.current;
        markStandalonePerf('snapshot_applied', {
            windowId,
            snapshotId,
            ...getRevisionPerfDetail(state),
        });
        windowGateway.emit(`rpc-applied-${windowId}`, { snapshotId }).catch(() => { });
        pendingSnapshotIdRef.current = null;
    }, [state, windowId]);

    useEffect(() => {
        let isMounted = true;
        let unsubscribeSync: (() => void) | undefined;
        let unsubscribePatch: (() => void) | undefined;
        let unsubscribeActiveModelChanged: (() => void) | undefined;
        let hasReceivedData = false;
        let pendingActiveModelRequest = false;
        let activeModelRequestTimer: number | null = null;
        const bootstrapTimeouts: number[] = [];
        const windowLabel = windowGateway.getCurrentWindowLabel();

        debugLog(`[RPC Client][${windowId}] Mounting client hook...`);
        markStandalonePerf('rpc_client_mounted', { windowId, windowLabel });

        const emitRequest = (reason: string) => {
            debugLog(`[RPC Client][${windowId}] Emitting req (${reason})...`);
            windowGateway.emit(`rpc-req-${windowId}`).catch(e => debugLog(`[RPC Client] Emit Error: ${e}`));
        };

        const emitReady = () => {
            markStandalonePerf('child_ready_emitted', { windowId, windowLabel });
            windowGateway.emit(`rpc-ready-${windowId}`).catch(e => debugLog(`[RPC Client] Ready Emit Error: ${e}`));
        };

        const clearBootstrapTimeouts = () => {
            while (bootstrapTimeouts.length > 0) {
                const timeoutId = bootstrapTimeouts.pop();
                if (timeoutId !== undefined) clearTimeout(timeoutId);
            }
        };

        const clearActiveModelRequestTimer = () => {
            if (activeModelRequestTimer !== null) {
                window.clearTimeout(activeModelRequestTimer);
                activeModelRequestTimer = null;
            }
        };

        const isWindowVisible = () => document.visibilityState !== 'hidden';

        const scheduleActiveModelRequest = (reason: string, delayMs = 900) => {
            clearActiveModelRequestTimer();
            activeModelRequestTimer = window.setTimeout(() => {
                activeModelRequestTimer = null;
                if (!isMounted || hasReceivedData) return;
                if (!isWindowVisible()) {
                    pendingActiveModelRequest = true;
                    return;
                }
                pendingActiveModelRequest = false;
                markStandalonePerf('snapshot_request_after_model_change', { windowId, windowLabel, reason, delayMs });
                emitRequest(reason);
                bootstrapRequestedRef.current = false;
                scheduleBootstrapRequests();
            }, delayMs);
        };

        const scheduleBootstrapRequests = () => {
            if (bootstrapRequestedRef.current) return;
            bootstrapRequestedRef.current = true;

            [180, 420].forEach((delay, index) => {
                const timeoutId = window.setTimeout(() => {
                    if (!isMounted || hasReceivedData) return;
                    emitRequest(`bootstrap-fallback-${index}`);
                }, delay);
                bootstrapTimeouts.push(timeoutId);
            });
        };

        windowGateway.listen(`rpc-sync-${windowId}`, (event) => {
            const snapshotId = ++receivedSnapshotCounterRef.current;

            void (async () => {
                const decoded = await normalizeRpcSyncPayload<TState>(getEventPayload<unknown>(event));
                if (!isMounted) return;
                // 异步解码完成顺序可能乱序，只应用仍与「当前最新接收序号」一致的那次快照
                if (snapshotId !== receivedSnapshotCounterRef.current) return;

                const keyPreview =
                    decoded && typeof decoded === 'object'
                        ? Object.keys(decoded as Record<string, unknown>).join(',')
                        : '';
                debugLog(`[RPC Client][${windowId}] Received state sync: ${keyPreview}`);
                hasReceivedData = true;
                clearBootstrapTimeouts();

                pendingSnapshotIdRef.current = snapshotId;
                markSnapshotReceived({
                    windowId,
                    snapshotId,
                    keyCount: getPayloadKeyCount(decoded),
                    ...getRevisionPerfDetail(decoded),
                });

                startTransition(() => {
                    if (!isMounted) return;
                    setState((previousState) => {
                        if (shouldIgnoreStaleSnapshot(previousState, decoded)) {
                            const previousRevision = asRevisionedRpcState(previousState)
                            const nextRevision = asRevisionedRpcState(decoded)
                            markSnapshotIgnoredStale({
                                windowId,
                                snapshotId,
                                previousDocumentId: previousRevision?.documentId ?? '',
                                nextDocumentId: nextRevision?.documentId ?? '',
                                previousDocumentRevision: previousRevision?.documentRevision ?? 0,
                                nextDocumentRevision: nextRevision?.documentRevision ?? 0,
                                previousSnapshotVersion: previousRevision?.snapshotVersion ?? 0,
                                nextSnapshotVersion: nextRevision?.snapshotVersion ?? 0,
                            })
                            pendingSnapshotIdRef.current = null
                            return previousState
                        }
                        return decoded
                    });
                });
            })();
        }).then(unlisten => {
            if (!isMounted) {
                unlisten();
                return;
            }
            unsubscribeSync = unlisten;
            emitReady();
            scheduleBootstrapRequests();
        }).catch(e => debugLog(`[RPC Client] Sync Listen Error: ${e}`));

        windowGateway.listen(`rpc-patch-${windowId}`, (event) => {
            const applyPatch = applyPatchRef.current
            if (!applyPatch) {
                return
            }

            const payload = getEventPayload<TPatch>(event)
            markStandalonePerf('patch_received', {
                windowId,
                keyCount: getPayloadKeyCount(payload),
            })
            setState((previousState) => applyPatch(previousState, payload))
        }).then(unlisten => {
            if (!isMounted) {
                unlisten();
                return;
            }
            unsubscribePatch = unlisten;
        }).catch(e => debugLog(`[RPC Client] Patch Listen Error: ${e}`));

        windowGateway.listen('active-model-changed', (event) => {
            const payload = getEventPayload<ActiveModelChangedPayload>(event);
            if (!payload?.hasModelData) {
                hasReceivedData = false;
                clearBootstrapTimeouts();
                clearActiveModelRequestTimer();
                pendingActiveModelRequest = false;
                pendingSnapshotIdRef.current = null;
                setState(initialState);
                return;
            }
            hasReceivedData = false;
            clearBootstrapTimeouts();
            if (!isWindowVisible()) {
                pendingActiveModelRequest = true;
                markStandalonePerf('snapshot_request_deferred_hidden', { windowId, windowLabel });
                return;
            }
            scheduleActiveModelRequest('active-model-changed-fallback', 900);
        }).then(unlisten => {
            if (!isMounted) {
                unlisten();
                return;
            }
            unsubscribeActiveModelChanged = unlisten;
        }).catch(e => debugLog(`[RPC Client] Active-model listen error: ${e}`));

        const handleVisibilityChange = () => {
            if (!pendingActiveModelRequest || !isWindowVisible()) return;
            scheduleActiveModelRequest('active-model-visible', 120);
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            debugLog(`[RPC Client][${windowId}] Unmounting client hook.`);
            isMounted = false;
            bootstrapRequestedRef.current = false;
            if (unsubscribeSync) unsubscribeSync();
            if (unsubscribePatch) unsubscribePatch();
            if (unsubscribeActiveModelChanged) unsubscribeActiveModelChanged();
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            clearBootstrapTimeouts();
            clearActiveModelRequestTimer();
        }
    }, [windowId]);

    const emitCommand = useCallback((command: string, payload?: unknown) => {
        windowGateway.emit(`rpc-cmd-${windowId}`, { command, payload }).catch(console.error);
    }, [windowId]);

    return { state, emitCommand };
}
