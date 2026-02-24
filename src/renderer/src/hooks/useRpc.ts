import { useEffect, useState, useCallback, useRef } from 'react';
import { emit, listen } from '@tauri-apps/api/event';
import { debugLog } from '../utils/debugLog';

/**
 * useRpcServer - Hook for the MAIN window (data source)
 * @param windowId The identifier for the target window to sync with
 * @param getLatestState A getter function that returns the slice of state needed by the client
 * @param onCommand A callback to execute actual logic when the client window triggers an action
 */
export function useRpcServer<T>(
    windowId: string,
    getLatestState: () => T,
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
        let unsubscribeCmd: (() => void) | undefined;

        debugLog(`[RPC Server][${windowId}] Mounting server hook...`);

        // Listen for when client window requests initial synchronization
        listen(`rpc-req-${windowId}`, () => {
            debugLog(`[RPC Server][${windowId}] Received request for sync from client.`);
            const state = getLatestStateRef.current();
            emit(`rpc-sync-${windowId}`, state);
        }).then(unlisten => {
            if (!isMounted) unlisten();
            else unsubscribeReq = unlisten;
        }).catch(console.error);

        // Listen for execution commands from the client window
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
            if (unsubscribeCmd) unsubscribeCmd();
        }
    }, [windowId]);

    // Used to push updates to the client whenever the main central store changes
    const broadcastSync = useCallback((state: T) => {
        debugLog(`[RPC Server][${windowId}] Broadcasting state. Object keys: ${Object.keys(state as any).join(',')}`);
        emit(`rpc-sync-${windowId}`, state);
    }, [windowId]);

    return { broadcastSync };
}

/**
 * useRpcClient - Hook for the SECONDARY isolated window (data receiver & command sender)
 * @param windowId The identifier of THIS window
 * @param initialState The default fallback state
 */
export function useRpcClient<T>(windowId: string, initialState: T) {
    const [state, setState] = useState<T>(initialState);

    useEffect(() => {
        let isMounted = true;
        let unsubscribeSync: (() => void) | undefined;
        let hasReceivedData = false;

        debugLog(`[RPC Client][${windowId}] Mounting client hook...`);

        // Listen for new state updates coming down from the master window
        listen<T>(`rpc-sync-${windowId}`, (event) => {
            debugLog(`[RPC Client][${windowId}] Received state sync: ${Object.keys(event.payload as any).join(',')}`);
            hasReceivedData = true;
            setState(event.payload);
        }).then(unlisten => {
            if (!isMounted) {
                unlisten();
                return;
            }
            unsubscribeSync = unlisten;

            // Request the main window to send the current state immediately upon mounting
            debugLog(`[RPC Client][${windowId}] Emitting initial req...`);
            emit(`rpc-req-${windowId}`).catch(e => debugLog(`[RPC Client] Emit Error: ${e}`));

            // Handshake polling: The server (MainLayout) might be still booting up 
            // since the client (Standalone Window) is preloaded. Keep asking until we get an answer.
            const pollInterval = setInterval(() => {
                if (!isMounted || hasReceivedData) {
                    clearInterval(pollInterval);
                    return;
                }
                debugLog(`[RPC Client][${windowId}] Polling for req...`);
                emit(`rpc-req-${windowId}`).catch(e => debugLog(`[RPC Client] Emit Error: ${e}`));
            }, 500);

        }).catch(e => debugLog(`[RPC Client] Sync Listen Error: ${e}`));

        return () => {
            debugLog(`[RPC Client][${windowId}] Unmounting client hook.`);
            isMounted = false;
            if (unsubscribeSync) unsubscribeSync();
        }
    }, [windowId]);

    // Send an execution instruction up to the master window
    const emitCommand = useCallback((command: string, payload?: any) => {
        emit(`rpc-cmd-${windowId}`, { command, payload }).catch(console.error);
    }, [windowId]);

    return { state, emitCommand };
}
