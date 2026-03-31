import React, { useEffect, useRef, useState } from 'react';
import { thumbnailEventBus } from './ThumbnailEventBus';

interface AnimatedPreviewProps {
    fullPath?: string;
    bitmap?: ImageBitmap | null;
    width?: number;
    height?: number;
    isSelected?: boolean;
}

/**
 * AnimatedPreview - A high-performance 2D view for model animations
 * 
 * Instead of having its own WebGL context, it displays bitmaps rendered
 * by the centralized ThumbnailService. This avoids WebGL context corruption.
 */
export const AnimatedPreview: React.FC<AnimatedPreviewProps> = React.memo(({
    fullPath,
    bitmap,
    width = 160,
    height = 160,
    isSelected = false
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const hostRef = useRef<HTMLDivElement>(null);
    const bitmapRef = useRef<ImageBitmap | null>(null);
    const rafRef = useRef<number | null>(null);
    const hasBitmapRef = useRef<boolean>(false);
    const [hasBitmap, setHasBitmap] = useState<boolean>(() => {
        if (bitmap) return true;
        if (fullPath) return !!thumbnailEventBus.getBitmap(fullPath);
        return false;
    });

    const drawBitmap = () => {
        const canvas = canvasRef.current;
        const bmp = bitmapRef.current;
        if (!canvas || !bmp) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Clear and draw the new bitmap
        // Using try-catch because ImageBitmaps can be detached/closed rapidly
        // in high-concurrency animation loops between prop arrival and component mount.
        try {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
        } catch (e) {
            // Silently fail - next frame will fix it.
            // console.warn('[AnimatedPreview] Skipping detached frame');
        }
    };

    const scheduleDraw = () => {
        if (typeof window === 'undefined') {
            drawBitmap();
            return;
        }
        if (rafRef.current !== null) return;
        rafRef.current = window.requestAnimationFrame(() => {
            rafRef.current = null;
            drawBitmap();
        });
    };

    const syncCanvasResolution = () => {
        const canvas = canvasRef.current;
        const host = hostRef.current;
        if (!canvas || !host) return;

        const rect = host.getBoundingClientRect();
        const cssW = rect.width > 0 ? rect.width : width;
        const cssH = rect.height > 0 ? rect.height : height;
        const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 3) : 1;

        let targetW = Math.max(1, Math.round(cssW * dpr));
        let targetH = Math.max(1, Math.round(cssH * dpr));

        // Prevent pathological allocations while still keeping cards crisp.
        const MAX_EDGE = 1536;
        const maxEdge = Math.max(targetW, targetH);
        if (maxEdge > MAX_EDGE) {
            const scale = MAX_EDGE / maxEdge;
            targetW = Math.max(1, Math.round(targetW * scale));
            targetH = Math.max(1, Math.round(targetH * scale));
        }

        if (canvas.width !== targetW || canvas.height !== targetH) {
            canvas.width = targetW;
            canvas.height = targetH;
            scheduleDraw();
        }
    };

    useEffect(() => {
        bitmapRef.current = bitmap || null;
        if (bitmap) {
            if (!hasBitmapRef.current) {
                hasBitmapRef.current = true;
                setHasBitmap(true);
            }
            scheduleDraw();
        } else if (!fullPath) {
            hasBitmapRef.current = false;
            setHasBitmap(false);
        }
    }, [bitmap]);

    useEffect(() => {
        if (!fullPath) return;

        const existing = thumbnailEventBus.getBitmap(fullPath) || null;
        bitmapRef.current = existing;
        hasBitmapRef.current = !!existing;
        setHasBitmap(!!existing);
        if (existing) {
            scheduleDraw();
        }

        const handleUpdate = (nextBitmap: ImageBitmap) => {
            bitmapRef.current = nextBitmap;
            if (!hasBitmapRef.current) {
                hasBitmapRef.current = true;
                setHasBitmap(true);
            }
            scheduleDraw();
        };

        thumbnailEventBus.on(`update:${fullPath}`, handleUpdate);
        return () => {
            thumbnailEventBus.off(`update:${fullPath}`, handleUpdate);
        };
    }, [fullPath]);

    useEffect(() => {
        syncCanvasResolution();

        let observer: ResizeObserver | null = null;
        if (typeof ResizeObserver !== 'undefined' && hostRef.current) {
            observer = new ResizeObserver(() => {
                syncCanvasResolution();
            });
            observer.observe(hostRef.current);
        }

        const onResize = () => syncCanvasResolution();
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
    }, [width, height]);

    return (
        <div ref={hostRef} style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            background: '#000',
            borderRadius: 4,
            overflow: 'hidden',
            position: 'relative'
        }}>
            <canvas
                ref={canvasRef}
                width={width}
                height={height}
                style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'fill',
                    border: isSelected ? '2px solid #1677ff' : 'none',
                    boxSizing: 'border-box'
                }}
            />
            {!hasBitmap && (
                <div style={{
                    position: 'absolute',
                    fontSize: 24,
                    color: '#333',
                    fontWeight: 'bold',
                    pointerEvents: 'none'
                }}>
                    MDX
                </div>
            )}
        </div>
    );
});
