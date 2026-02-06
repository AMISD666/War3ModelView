import React, { useEffect, useRef } from 'react';
import { thumbnailService } from './ThumbnailService';
import { useSelectionStore } from '../../store/selectionStore';

interface ThumbnailGeneratorProps {
    queue: { name: string; fullPath: string }[];
    onThumbnailReady: (fullPath: string, bitmap: ImageBitmap, animations?: string[]) => void;
    onItemProcessed: (fullPath: string) => void;
    isAnimating?: boolean;
    selectedAnimations?: Record<string, string>;
    modelAnimations?: Record<string, string[]>;
    visiblePaths?: Set<string>;
}

export const ThumbnailGenerator: React.FC<ThumbnailGeneratorProps> = ({
    queue,
    onThumbnailReady,
    onItemProcessed,
    isAnimating = true,
    selectedAnimations = {},
    modelAnimations = {},
    visiblePaths = new Set()
}) => {
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const mainMode = useSelectionStore(state => state.mainMode);
    const processedPaths = useRef<string[]>([]);
    const lastQueueRef = useRef<string[]>([]);
    const lastRenderTimeRef = useRef<number>(0);
    const selectedAnimationsRef = useRef(selectedAnimations);
    const modelAnimationsRef = useRef(modelAnimations);
    const pendingRequestsRef = useRef<Set<string>>(new Set());
    const lastPruneTimeRef = useRef<number>(0);
    const lastSelectionTimeRef = useRef<number>(0);

    // Track when selection changes to trigger aggressive throttling
    useEffect(() => {
        lastSelectionTimeRef.current = performance.now();
    }, [selectedAnimations]);

    // Sync refs to avoid loop resets when switching animations
    useEffect(() => {
        selectedAnimationsRef.current = selectedAnimations;
    }, [selectedAnimations]);

    useEffect(() => {
        modelAnimationsRef.current = modelAnimations;
    }, [modelAnimations]);

    // Clear processed paths when queue is reset
    useEffect(() => {
        const currentQueuePaths = queue.map(q => q.fullPath);
        const hasNewItems = currentQueuePaths.some(p => !lastQueueRef.current.includes(p));
        const queueWasEmpty = lastQueueRef.current.length === 0;

        if (queue.length > 0 && (queueWasEmpty || hasNewItems)) {
            processedPaths.current = [];
        }

        lastQueueRef.current = currentQueuePaths;
    }, [queue]);

    useEffect(() => {
        let active = true;

        const loop = async () => {
            if (!active) return;

            const time = performance.now();

            // 1. Process Initial Queue (Parallel Workers)
            if (queue.length > 0) {
                const batchSize = 12; // Dispatch multiple tasks matching worker count
                const items = queue.slice(0, batchSize);

                await Promise.all(items.map(async (item) => {
                    try {
                        let animName = selectedAnimations[item.fullPath];
                        let animList = modelAnimations[item.fullPath] || thumbnailService.getCachedAnimations(item.fullPath) || [];

                        // Default to the first animation
                        if (!animName && animList.length > 0) {
                            animName = animList[0];
                        }

                        const animIndex = isAnimating && animName ? Math.max(0, animList.indexOf(animName)) : 0;
                        const frameTime = isAnimating ? performance.now() : 0;

                        const result = await thumbnailService.renderFrame(item.fullPath, frameTime, animIndex, !isAnimating);

                        if (result && result.status === 'success' && result.bitmap) {
                            onThumbnailReady(item.fullPath, result.bitmap, result.animations);
                            if (!processedPaths.current.includes(item.fullPath)) {
                                processedPaths.current.push(item.fullPath);
                            }
                            onItemProcessed(item.fullPath);
                        } else if (result.status === 'error') {
                            onItemProcessed(item.fullPath);
                        }
                    } catch (e) {
                        console.error('[ThumbnailGenerator] Render error:', e);
                        onItemProcessed(item.fullPath);
                    }
                }));

                timerRef.current = setTimeout(loop, 0);
                return;
            }

            // 2. Animation Loop for processed models
            const now = time;

            // ADAPTIVE THROTTLING
            // 1. Base interval: 80ms (~12fps) instead of 40ms.
            // 2. Selection back-off: If a model was selected < 3s ago, throttle to 1000ms (1fps)
            //    This is especially important now that we are using 12 background workers.
            const timeSinceSelection = now - lastSelectionTimeRef.current;
            const throttleLimit = timeSinceSelection < 3000 ? 1000 : 80;

            const timeSinceLastRender = now - lastRenderTimeRef.current;
            if (timeSinceLastRender < throttleLimit) {
                timerRef.current = setTimeout(loop, Math.max(1, throttleLimit - timeSinceLastRender));
                return;
            }
            lastRenderTimeRef.current = now;

            if (processedPaths.current.length > 0) {
                const currentMode = useSelectionStore.getState().mainMode;

                // PERFORMANCE FIX: Stop background loop if not in batch mode
                if (currentMode !== 'batch') {
                    active = false;
                    if (timerRef.current) clearTimeout(timerRef.current);
                    return;
                }

                if (isAnimating) {
                    const itemsToAnimate = processedPaths.current.filter(p => visiblePaths.has(p));

                    // PERIODIC PRUNE: Relaxed to 10 seconds to prevent thrashing
                    if (now - lastPruneTimeRef.current > 10000) {
                        lastPruneTimeRef.current = now;
                        const activeSet = new Set(queue.map(q => q.fullPath));
                        // Also keep visible ones just in case
                        visiblePaths.forEach(p => activeSet.add(p));
                        const { thumbnailEventBus } = await import('./ThumbnailEventBus');
                        thumbnailEventBus.prune(activeSet);
                    }

                    if (itemsToAnimate.length > 0) {
                        // GREEDY DISPATCH: Try to update ALL visible items every tick 
                        // ThumbnailService will assign to free workers or return 'busy'
                        itemsToAnimate.forEach((targetPath) => {
                            if (pendingRequestsRef.current.has(targetPath)) return;

                            const animName = selectedAnimationsRef.current[targetPath];
                            const animList = modelAnimationsRef.current[targetPath] || [];
                            const animIndex = animName ? Math.max(0, animList.indexOf(animName)) : 0;

                            pendingRequestsRef.current.add(targetPath);

                            // CORRECTED ARGUMENTS: (path, frame, sequenceIndex)
                            thumbnailService.renderFrame(targetPath, now, animIndex, false).then(res => {
                                pendingRequestsRef.current.delete(targetPath);
                                if (res.status === 'success' && res.bitmap) {
                                    onThumbnailReady(targetPath, res.bitmap, res.animations);
                                }
                            }).catch(() => {
                                pendingRequestsRef.current.delete(targetPath);
                            });
                        });
                    }
                }
            }

            if (active) {
                timerRef.current = setTimeout(loop, throttleLimit);
            }
        };

        timerRef.current = setTimeout(loop, 0);

        return () => {
            active = false;
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, [queue, onThumbnailReady, onItemProcessed, isAnimating, visiblePaths, mainMode]);

    return null;
};
