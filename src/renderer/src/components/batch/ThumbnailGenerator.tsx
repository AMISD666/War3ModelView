import React, { useEffect, useRef } from 'react';
import { thumbnailService } from './ThumbnailService';
import { useSelectionStore } from '../../store/selectionStore';

const BATCH_MAX_WORKER_FPS = 144;
const BATCH_MAX_WORKER_FRAME_INTERVAL_MS = 1000 / BATCH_MAX_WORKER_FPS;
const INITIAL_RENDER_WORKER_LIMIT = 12;
const TEXTURE_FIRST_FRAME_COUNT = 0;

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
    workerLimit?: number;
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
    workerLimit,
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
    const textureFirstFramePathsRef = useRef<Set<string>>(new Set());
    const lastPruneTimeRef = useRef<number>(0);
    const lastAnimatedAtRef = useRef<Map<string, number>>(new Map());

    const pickStalestTargets = (paths: string[], limit: number, selectedPinned?: string | null) => {
        const result: string[] = [];
        if (selectedPinned) {
            result.push(selectedPinned);
        }
        if (limit <= result.length) return result;

        const lastAnimatedAt = lastAnimatedAtRef.current;
        const pool = paths.filter((path) => path !== selectedPinned);
        if (pool.length === 0) return result;

        const ranked: Array<{ path: string; time: number }> = [];
        for (const path of pool) {
            const time = lastAnimatedAt.get(path) || 0;
            if (ranked.length < limit - result.length) {
                ranked.push({ path, time });
                ranked.sort((a, b) => a.time - b.time);
                continue;
            }

            const newestPicked = ranked[ranked.length - 1];
            if (newestPicked && time < newestPicked.time) {
                ranked[ranked.length - 1] = { path, time };
                ranked.sort((a, b) => a.time - b.time);
            }
        }

        ranked.forEach((entry) => result.push(entry.path));
        return result;
    };

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
            textureFirstFramePathsRef.current = new Set(currentQueuePaths.slice(0, TEXTURE_FIRST_FRAME_COUNT));
        }

        lastQueueRef.current = currentQueuePaths;
    }, [queue]);

    useEffect(() => {
        let active = true;

        const loop = async () => {
            if (!active) return;

            const time = performance.now();
            const shouldAnimateFrames = isAnimating || selfSpinEnabled;
            let scheduledWork = false;
            let workerStats = thumbnailService.getWorkerStats();
            let freeWorkers = Math.max(0, workerStats.total - workerStats.busy);

            // 1. Process Initial Queue without monopolizing every worker.
            if (queue.length > 0 && freeWorkers > 0) {
                const visibleProcessedCount = processedPaths.current.reduce((count, path) => count + (visiblePaths.has(path) ? 1 : 0), 0);
                const animationReserve = shouldAnimateFrames && visibleProcessedCount > 0
                    ? (
                        visibleProcessedCount >= 48 ? Math.min(4, Math.max(2, Math.floor(workerStats.total / 2)))
                            : visibleProcessedCount >= 24 ? Math.min(3, Math.max(2, Math.ceil(workerStats.total / 3)))
                                : Math.min(2, Math.max(1, Math.floor(workerStats.total / 4)))
                    )
                    : 0;
                const perPageCap = workerLimit && workerLimit > 0 ? workerLimit : freeWorkers;
                const queueBudget = Math.max(
                    0,
                    Math.min(queue.length, Math.max(0, freeWorkers - animationReserve), perPageCap, INITIAL_RENDER_WORKER_LIMIT)
                );
                const candidates = queue
                    .filter(item => !queueInFlightRef.current.has(item.fullPath))
                    .slice(0, queueBudget);

                const sharedState = candidates.length > 0
                    ? await thumbnailService.prepareBatchRenderState()
                    : null;

                candidates.forEach((item) => {
                    queueInFlightRef.current.add(item.fullPath);

                    const selectedAnimName = selectedAnimationsRef.current[item.fullPath];
                    const animList = modelAnimationsRef.current[item.fullPath] || thumbnailService.getCachedAnimations(item.fullPath) || [];
                    const animIndex = resolveAnimationIndex(animList, selectedAnimName);
                    const frameTime = shouldAnimateFrames ? performance.now() : 0;

                    thumbnailService.renderFrameWithSharedState(
                        item.fullPath,
                        frameTime,
                        animIndex,
                        !isAnimating,
                        {
                            // The first N cards on each page wait for textures to avoid placeholder magenta.
                            preferFastFirstFrame: !textureFirstFramePathsRef.current.has(item.fullPath),
                            prioritize: selectedPath === item.fullPath,
                            spinEnabled: selfSpinEnabled,
                            spinSpeed: selfSpinSpeed
                        },
                        sharedState || undefined
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
                if (candidates.length > 0) {
                    scheduledWork = true;
                    workerStats = thumbnailService.getWorkerStats();
                    freeWorkers = Math.max(0, workerStats.total - workerStats.busy);
                }
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

                const initialQueuePending = queue.some(item => !processedPaths.current.includes(item.fullPath));
                if (shouldAnimateFrames && !initialQueuePending) {
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
                        if (freeWorkers <= 0) {
                            if (active) timerRef.current = setTimeout(loop, 2);
                            return;
                        }
                        const perPageCap = workerLimit && workerLimit > 0 ? workerLimit : freeWorkers;
                        // Avoid oversubscribing workers under high-card pages; this keeps frame pacing stable.
                        const dynamicBudget = Math.max(1, Math.min(itemsToAnimate.length, freeWorkers, perPageCap));
                        const targets = pickStalestTargets(itemsToAnimate, dynamicBudget, selectedInView);
                        const sharedState = targets.length > 0
                            ? await thumbnailService.prepareBatchRenderState()
                            : null;

                        targets.forEach((targetPath) => {
                            if (pendingRequestsRef.current.has(targetPath)) return;

                            const animName = selectedAnimationsRef.current[targetPath];
                            const animList = modelAnimationsRef.current[targetPath]
                                || thumbnailService.getCachedAnimations(targetPath)
                                || [];
                            const animIndex = resolveAnimationIndex(animList, animName);

                            pendingRequestsRef.current.add(targetPath);

                            thumbnailService.renderFrameWithSharedState(targetPath, now, animIndex, !isAnimating, {
                                prioritize: !!selectedInView && selectedPath === targetPath,
                                spinEnabled: selfSpinEnabled,
                                spinSpeed: selfSpinSpeed
                            }, sharedState || undefined).then(res => {
                                pendingRequestsRef.current.delete(targetPath);
                                if (res.status === 'success' && res.bitmap) {
                                    lastAnimatedAtRef.current.set(targetPath, performance.now());
                                    onThumbnailReady(targetPath, res.bitmap, res.animations);
                                }
                            }).catch(() => {
                                pendingRequestsRef.current.delete(targetPath);
                            });
                        });
                        if (targets.length > 0) {
                            scheduledWork = true;
                        }
                    }
                }
            }

            if (active) {
                timerRef.current = setTimeout(loop, scheduledWork || queue.length > 0 ? 0 : throttleLimit);
            }
        };

        timerRef.current = setTimeout(loop, 0);

        return () => {
            active = false;
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, [queue, onThumbnailReady, onItemProcessed, isAnimating, selfSpinEnabled, selfSpinSpeed, workerLimit, visiblePaths, mainMode, selectedPath]);

    return null;
};
