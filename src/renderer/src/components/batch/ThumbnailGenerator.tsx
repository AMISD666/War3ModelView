import React, { useEffect, useRef } from 'react';
import { thumbnailService } from './ThumbnailService';
import { useSelectionStore } from '../../store/selectionStore';

const BATCH_MAX_WORKER_FPS = 144;
const BATCH_MAX_WORKER_FRAME_INTERVAL_MS = 1000 / BATCH_MAX_WORKER_FPS;

function pickPreferredAnimation(animations: string[]): string | undefined {
    if (animations.length === 0) return undefined;

    const exactStand = animations.find((name) => name.trim().toLowerCase() === 'stand');
    if (exactStand) return exactStand;

    const standPrefix = animations.find((name) => /^stand(\b|[^a-z0-9_])/i.test(name.trim()));
    if (standPrefix) return standPrefix;

    const standContains = animations.find((name) => name.trim().toLowerCase().includes('stand'));
    return standContains ?? animations[0];
}

function resolveAnimationIndex(animations: string[], selectedName?: string): number {
    if (selectedName) {
        const selectedIndex = animations.indexOf(selectedName);
        if (selectedIndex >= 0) return selectedIndex;
    }
    const preferred = pickPreferredAnimation(animations);
    if (!preferred) return 0;
    return Math.max(0, animations.indexOf(preferred));
}

interface ThumbnailGeneratorProps {
    queue: { name: string; fullPath: string }[];
    onThumbnailReady: (fullPath: string, bitmap: ImageBitmap, animations?: string[]) => void;
    onItemProcessed: (fullPath: string) => void;
    isAnimating?: boolean;
    selfSpinEnabled?: boolean;
    selfSpinSpeed?: number;
    selectedAnimations?: Record<string, string>;
    modelAnimations?: Record<string, string[]>;
    visiblePaths?: Set<string>;
    selectedPath?: string | null;
}

export const ThumbnailGenerator: React.FC<ThumbnailGeneratorProps> = ({
    queue,
    onThumbnailReady,
    onItemProcessed,
    isAnimating = true,
    selfSpinEnabled = false,
    selfSpinSpeed = 70,
    selectedAnimations = {},
    modelAnimations = {},
    visiblePaths = new Set(),
    selectedPath = null
}) => {
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const mainMode = useSelectionStore(state => state.mainMode);
    const processedPaths = useRef<string[]>([]);
    const lastQueueRef = useRef<string[]>([]);
    const lastRenderTimeRef = useRef<number>(0);
    const selectedAnimationsRef = useRef(selectedAnimations);
    const modelAnimationsRef = useRef(modelAnimations);
    const pendingRequestsRef = useRef<Set<string>>(new Set());
    const queueInFlightRef = useRef<Set<string>>(new Set());
    const lastPruneTimeRef = useRef<number>(0);
    const roundRobinCursorRef = useRef<number>(0);

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
            const shouldAnimateFrames = isAnimating || selfSpinEnabled;

            // 1. Process Initial Queue (Parallel Workers)
            if (queue.length > 0) {
                const { busy, total } = thumbnailService.getWorkerStats();
                const freeWorkers = Math.max(0, total - busy);
                if (freeWorkers <= 0) {
                    timerRef.current = setTimeout(loop, 2);
                    return;
                }
                const maxDispatch = Math.max(1, Math.min(queue.length, freeWorkers));
                const candidates = queue
                    .filter(item => !queueInFlightRef.current.has(item.fullPath))
                    .slice(0, maxDispatch);

                candidates.forEach((item) => {
                    queueInFlightRef.current.add(item.fullPath);

                    const selectedAnimName = selectedAnimationsRef.current[item.fullPath];
                    const animList = modelAnimationsRef.current[item.fullPath] || thumbnailService.getCachedAnimations(item.fullPath) || [];
                    const animIndex = resolveAnimationIndex(animList, selectedAnimName);
                    const frameTime = shouldAnimateFrames ? performance.now() : 0;

                    thumbnailService.renderFrame(
                        item.fullPath,
                        frameTime,
                        animIndex,
                        !isAnimating,
                        {
                            // Always prioritize first visual response, then stream textures in.
                            preferFastFirstFrame: true,
                            prioritize: selectedPath === item.fullPath,
                            spinEnabled: selfSpinEnabled,
                            spinSpeed: selfSpinSpeed
                        }
                    )
                        .then((result) => {
                            if (result && result.status === 'success' && result.bitmap) {
                                onThumbnailReady(item.fullPath, result.bitmap, result.animations);
                                if (!processedPaths.current.includes(item.fullPath)) {
                                    processedPaths.current.push(item.fullPath);
                                }
                                onItemProcessed(item.fullPath);
                            } else if (result?.status === 'error') {
                                onItemProcessed(item.fullPath);
                            }
                        })
                        .catch((e) => {
                            console.error('[ThumbnailGenerator] Render error:', e);
                            onItemProcessed(item.fullPath);
                        })
                        .finally(() => {
                            queueInFlightRef.current.delete(item.fullPath);
                        });
                });

                timerRef.current = setTimeout(loop, candidates.length > 0 ? 0 : 8);
                return;
            }

            // 2. Animation Loop for processed models
            const now = time;

            const throttleLimit = BATCH_MAX_WORKER_FRAME_INTERVAL_MS;

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

                if (shouldAnimateFrames) {
                    const itemsToAnimate = processedPaths.current.filter(p => visiblePaths.has(p));
                    const shouldPinSelected = itemsToAnimate.length <= 12;
                    const selectedInView = shouldPinSelected && selectedPath && itemsToAnimate.includes(selectedPath) ? selectedPath : null;

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
                        const { busy, total } = thumbnailService.getWorkerStats();
                        const freeWorkers = Math.max(0, total - busy);
                        if (freeWorkers <= 0) {
                            if (active) timerRef.current = setTimeout(loop, 2);
                            return;
                        }
                        // Avoid oversubscribing workers under high-card pages; this keeps frame pacing stable.
                        const dynamicBudget = Math.max(1, Math.min(itemsToAnimate.length, freeWorkers));

                        const nonSelected = selectedInView
                            ? itemsToAnimate.filter(p => p !== selectedInView)
                            : itemsToAnimate.slice();
                        const targets: string[] = [];

                        if (selectedInView) {
                            targets.push(selectedInView);
                        }

                        if (nonSelected.length > 0 && targets.length < dynamicBudget) {
                            const start = roundRobinCursorRef.current % nonSelected.length;
                            let idx = start;
                            while (targets.length < dynamicBudget && targets.length < itemsToAnimate.length) {
                                const path = nonSelected[idx];
                                if (!targets.includes(path)) {
                                    targets.push(path);
                                }
                                idx = (idx + 1) % nonSelected.length;
                                if (idx === start) break;
                            }
                            const requestedStep = Math.max(1, dynamicBudget - (selectedInView ? 1 : 0));
                            const normalizedStep = requestedStep % nonSelected.length === 0 ? 1 : requestedStep;
                            roundRobinCursorRef.current = (start + normalizedStep) % nonSelected.length;
                        }

                        targets.forEach((targetPath) => {
                            if (pendingRequestsRef.current.has(targetPath)) return;

                            const animName = selectedAnimationsRef.current[targetPath];
                            const animList = modelAnimationsRef.current[targetPath] || [];
                            const animIndex = resolveAnimationIndex(animList, animName);

                            pendingRequestsRef.current.add(targetPath);

                            thumbnailService.renderFrame(targetPath, now, animIndex, !isAnimating, {
                                prioritize: !!selectedInView && selectedPath === targetPath,
                                spinEnabled: selfSpinEnabled,
                                spinSpeed: selfSpinSpeed
                            }).then(res => {
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

            if (active) timerRef.current = setTimeout(loop, throttleLimit);
        };

        timerRef.current = setTimeout(loop, 0);

        return () => {
            active = false;
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, [queue, onThumbnailReady, onItemProcessed, isAnimating, selfSpinEnabled, selfSpinSpeed, visiblePaths, mainMode, selectedPath]);

    return null;
};
