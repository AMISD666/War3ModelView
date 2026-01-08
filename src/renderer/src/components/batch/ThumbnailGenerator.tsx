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
    const animationFrameRef = useRef<number>(0);
    const mainMode = useSelectionStore(state => state.mainMode);
    const processedPaths = useRef<string[]>([]);
    const lastQueueRef = useRef<string[]>([]);
    const lastRenderTimeRef = useRef<number>(0);
    const selectedAnimationsRef = useRef(selectedAnimations);
    const modelAnimationsRef = useRef(modelAnimations);
    const pendingRequestsRef = useRef<Set<string>>(new Set());

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

        const loop = async (time: number) => {
            if (!active) return;

            // 1. Process Initial Queue (Parallel Workers)
            if (queue.length > 0) {
                const batchSize = 12; // Dispatch multiple tasks
                const items = queue.slice(0, batchSize);

                await Promise.all(items.map(async (item) => {
                    try {
                        let animName = selectedAnimations[item.fullPath];
                        let animList = modelAnimations[item.fullPath] || thumbnailService.getCachedAnimations(item.fullPath) || [];

                        // Default to the first animation
                        if (!animName && animList.length > 0) {
                            animName = animList[0];
                        }

                        const animIndex = animName ? Math.max(0, animList.indexOf(animName)) : 0;

                        const result = await thumbnailService.renderFrame(item.fullPath, performance.now(), animIndex);

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

                animationFrameRef.current = requestAnimationFrame(loop);
                return;
            }

            // 2. Animation Loop for processed models
            const now = performance.now();
            // THROTTLE: 40ms = ~25fps for background rendering stability
            if (now - lastRenderTimeRef.current < 40) {
                animationFrameRef.current = requestAnimationFrame(loop);
                return;
            }
            lastRenderTimeRef.current = now;

            if (processedPaths.current.length > 0) {
                const currentMode = useSelectionStore.getState().mainMode;

                // PERFORMANCE FIX: Stop background loop if not in batch mode
                if (currentMode !== 'batch') {
                    active = false;
                    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
                    return;
                }

                if (isAnimating) {
                    const itemsToAnimate = processedPaths.current.filter(p => visiblePaths.has(p));

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
                            thumbnailService.renderFrame(targetPath, now, animIndex).then(res => {
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
                animationFrameRef.current = requestAnimationFrame(loop);
            }
        };

        animationFrameRef.current = requestAnimationFrame(loop);

        return () => {
            active = false;
            if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
        };
    }, [queue, onThumbnailReady, onItemProcessed, isAnimating, visiblePaths, mainMode]);

    return null;
};
