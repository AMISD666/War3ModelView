import React, { useEffect, useRef, useState } from 'react';
import { thumbnailEventBus } from './ThumbnailEventBus';

interface ModelFile {
    name: string;
    path: string;
    fullPath: string;
}

interface SharedThumbnailCanvasProps {
    files: ModelFile[];
    fixedSize: number;
    gap: number;
}

interface SlotRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

const PREVIEW_INSET = 4;

export const SharedThumbnailCanvas: React.FC<SharedThumbnailCanvasProps> = React.memo(({
    files,
    fixedSize,
    gap
}) => {
    const hostRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const slotsRef = useRef<Map<string, SlotRect>>(new Map());
    const rafRef = useRef<number | null>(null);
    const dirtyPathsRef = useRef<Set<string>>(new Set());
    const needsFullRedrawRef = useRef<boolean>(true);
    const [contentHeight, setContentHeight] = useState(0);

    const drawSlot = (ctx: CanvasRenderingContext2D, fullPath: string) => {
        const slot = slotsRef.current.get(fullPath);
        if (!slot) return;

        const drawX = slot.x + PREVIEW_INSET;
        const drawY = slot.y + PREVIEW_INSET;
        const drawW = Math.max(1, slot.width - PREVIEW_INSET * 2);
        const drawH = Math.max(1, slot.height - PREVIEW_INSET * 2);

        ctx.clearRect(drawX, drawY, drawW, drawH);
        ctx.fillStyle = '#000';
        ctx.fillRect(drawX, drawY, drawW, drawH);

        const bitmap = thumbnailEventBus.getBitmap(fullPath);
        if (!bitmap) return;

        try {
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(bitmap, drawX, drawY, drawW, drawH);
        } catch {
            // Detached bitmaps are replaced on the next update.
        }
    };

    const drawAll = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        for (const file of files) {
            drawSlot(ctx, file.fullPath);
        }
    };

    const flushDraw = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        if (needsFullRedrawRef.current) {
            needsFullRedrawRef.current = false;
            dirtyPathsRef.current.clear();
            drawAll();
            return;
        }

        if (dirtyPathsRef.current.size === 0) return;

        const dirty = Array.from(dirtyPathsRef.current);
        dirtyPathsRef.current.clear();
        for (const fullPath of dirty) {
            drawSlot(ctx, fullPath);
        }
    };

    const scheduleDraw = (fullPath?: string) => {
        if (fullPath) {
            dirtyPathsRef.current.add(fullPath);
        } else {
            needsFullRedrawRef.current = true;
        }
        if (typeof window === 'undefined') {
            flushDraw();
            return;
        }
        if (rafRef.current !== null) return;
        rafRef.current = window.requestAnimationFrame(() => {
            rafRef.current = null;
            flushDraw();
        });
    };

    const rebuildLayout = () => {
        const host = hostRef.current;
        const canvas = canvasRef.current;
        if (!host || !canvas) return;

        const width = Math.max(1, host.clientWidth);
        const columns = Math.max(1, Math.floor((width + gap) / (fixedSize + gap)));
        const rows = files.length === 0 ? 0 : Math.ceil(files.length / columns);
        const nextHeight = rows === 0 ? 0 : rows * fixedSize + Math.max(0, rows - 1) * gap;

        const slots = new Map<string, SlotRect>();
        files.forEach((file, index) => {
            const row = Math.floor(index / columns);
            const column = index % columns;
            slots.set(file.fullPath, {
                x: column * (fixedSize + gap),
                y: row * (fixedSize + gap),
                width: fixedSize,
                height: fixedSize
            });
        });
        slotsRef.current = slots;
        needsFullRedrawRef.current = true;

        if (canvas.width !== width || canvas.height !== nextHeight) {
            canvas.width = width;
            canvas.height = nextHeight;
        }

        setContentHeight(nextHeight);
        scheduleDraw();
    };

    useEffect(() => {
        rebuildLayout();

        let observer: ResizeObserver | null = null;
        if (typeof ResizeObserver !== 'undefined' && hostRef.current) {
            observer = new ResizeObserver(() => rebuildLayout());
            observer.observe(hostRef.current);
        }

        const onResize = () => rebuildLayout();
        if (typeof window !== 'undefined') {
            window.addEventListener('resize', onResize);
        }

        return () => {
            if (observer) observer.disconnect();
            if (typeof window !== 'undefined') {
                window.removeEventListener('resize', onResize);
                if (rafRef.current !== null) {
                    window.cancelAnimationFrame(rafRef.current);
                    rafRef.current = null;
                }
            }
        };
    }, [files, fixedSize, gap]);

    useEffect(() => {
        const fileSet = new Set(files.map((file) => file.fullPath));
        const handleThumbnail = (fullPath: string) => {
            if (!fileSet.has(fullPath)) return;
            scheduleDraw(fullPath);
        };

        thumbnailEventBus.on('thumbnail', handleThumbnail);

        scheduleDraw();

        return () => {
            thumbnailEventBus.off('thumbnail', handleThumbnail);
        };
    }, [files]);

    return (
        <div
            ref={hostRef}
            style={{
                position: 'absolute',
                inset: 0,
                pointerEvents: 'none',
                zIndex: 1,
                minHeight: contentHeight
            }}
        >
            <canvas
                ref={canvasRef}
                style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    width: '100%',
                    height: contentHeight
                }}
            />
        </div>
    );
});
