import { useEffect, useState, useCallback, useRef } from 'react';
import { emit, listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { debugLog } from '../utils/debugLog';
import { markStandalonePerf } from '../utils/standalonePerf';
import { windowManager } from '../utils/WindowManager';

const getPayloadKeyCount = (payload: unknown): number => {
    if (!payload || typeof payload !== 'object') return 0
    return Object.keys(payload as Record<string, unknown>).length
}

interface RpcClientOptions<TState, TPatch> {
    applyPatch?: (previousState: TState, patch: TPatch) => TState
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
    onCommand?: (command: string, payload: any) => void
) {
    const getLatestStateRef = useRef(getLatestState);
    const onCommandRef = useRef(onCommand);

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

        listen(`rpc-req-${windowId}`, async () => {
            debugLog(`[RPC Server][${windowId}] Received request for sync from client.`);
            const state = getLatestStateRef.current();
            markStandalonePerf('snapshot_sent', {
                windowId,
                source: 'request_response',
                keyCount: getPayloadKeyCount(state),
            });
            await windowManager.emitToolWindowSync(windowId, state);
        }).then(unlisten => {
            if (!isMounted) unlisten();
            else unsubscribeReq = unlisten;
        }).catch(console.error);

        listen(`rpc-ready-${windowId}`, async () => {
            debugLog(`[RPC Server][${windowId}] Child reported READY.`);
            const state = getLatestStateRef.current();
            markStandalonePerf('snapshot_sent', {
                windowId,
                source: 'ready_signal',
                keyCount: getPayloadKeyCount(state),
            });
            await windowManager.emitToolWindowSync(windowId, state);
        }).then(unlisten => {
            if (!isMounted) unlisten();
            else unsubscribeReady = unlisten;
        }).catch(console.error);

        listen<{ command: string, payload: any }>(`rpc-cmd-${windowId}`, (event) => {
            debugLog(`[RPC Server][${windowId}] Received command: ${event.payload.command}`);
            if (onCommandRef.current) {
                onCommandRef.current(event.payload.command, event.payload.payload);
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

    const broadcastSync = useCallback((state: TState) => {
        debugLog(`[RPC Server][${windowId}] Broadcasting state. Object keys: ${Object.keys(state as any).join(',')}`);
        markStandalonePerf('snapshot_sent', {
            windowId,
            source: 'broadcast',
            keyCount: getPayloadKeyCount(state),
        });
        void windowManager.emitToolWindowSync(windowId, state);
    }, [windowId]);

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
        });
        emit(`rpc-applied-${windowId}`, { snapshotId }).catch(() => { });
        pendingSnapshotIdRef.current = null;
    }, [state, windowId]);

    useEffect(() => {
        let isMounted = true;
        let unsubscribeSync: (() => void) | undefined;
        let unsubscribePatch: (() => void) | undefined;
        let hasReceivedData = false;
        const bootstrapTimeouts: number[] = [];
        const currentWindow = getCurrentWindow();
        const windowLabel = currentWindow.label;

        debugLog(`[RPC Client][${windowId}] Mounting client hook...`);
        markStandalonePerf('rpc_client_mounted', { windowId, windowLabel });

        const emitRequest = (reason: string) => {
            debugLog(`[RPC Client][${windowId}] Emitting req (${reason})...`);
            emit(`rpc-req-${windowId}`).catch(e => debugLog(`[RPC Client] Emit Error: ${e}`));
        };

        const emitReady = () => {
            markStandalonePerf('child_ready_emitted', { windowId, windowLabel });
            emit(`rpc-ready-${windowId}`).catch(e => debugLog(`[RPC Client] Ready Emit Error: ${e}`));
        };

        const clearBootstrapTimeouts = () => {
            while (bootstrapTimeouts.length > 0) {
                const timeoutId = bootstrapTimeouts.pop();
                if (timeoutId !== undefined) clearTimeout(timeoutId);
            }
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

        listen<TState>(`rpc-sync-${windowId}`, (event) => {
            debugLog(`[RPC Client][${windowId}] Received state sync: ${Object.keys(event.payload as any).join(',')}`);
            hasReceivedData = true;
            clearBootstrapTimeouts();

            const snapshotId = ++receivedSnapshotCounterRef.current;
            pendingSnapshotIdRef.current = snapshotId;
            markStandalonePerf('snapshot_received', {
                windowId,
                snapshotId,
                keyCount: getPayloadKeyCount(event.payload),
            });

            setState(event.payload);
        }).then(unlisten => {
            if (!isMounted) {
                unlisten();
                return;
            }
            unsubscribeSync = unlisten;
            emitReady();
            scheduleBootstrapRequests();
        }).catch(e => debugLog(`[RPC Client] Sync Listen Error: ${e}`));

        listen<TPatch>(`rpc-patch-${windowId}`, (event) => {
            const applyPatch = applyPatchRef.current
            if (!applyPatch) {
                return
            }

            markStandalonePerf('patch_received', {
                windowId,
                keyCount: getPayloadKeyCount(event.payload),
            })
            setState((previousState) => applyPatch(previousState, event.payload))
        }).then(unlisten => {
            if (!isMounted) {
                unlisten();
                return;
            }
            unsubscribePatch = unlisten;
        }).catch(e => debugLog(`[RPC Client] Patch Listen Error: ${e}`));

        return () => {
            debugLog(`[RPC Client][${windowId}] Unmounting client hook.`);
            isMounted = false;
            bootstrapRequestedRef.current = false;
            if (unsubscribeSync) unsubscribeSync();
            if (unsubscribePatch) unsubscribePatch();
            clearBootstrapTimeouts();
        }
    }, [windowId]);

    const emitCommand = useCallback((command: string, payload?: any) => {
        emit(`rpc-cmd-${windowId}`, { command, payload }).catch(console.error);
    }, [windowId]);

    return { state, emitCommand };
}

