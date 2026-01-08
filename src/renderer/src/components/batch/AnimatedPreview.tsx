import React, { useEffect, useRef } from 'react';

interface AnimatedPreviewProps {
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
    bitmap,
    width = 256,
    height = 256,
    isSelected = false
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !bitmap) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Clear and draw the new bitmap
        // Using try-catch because ImageBitmaps can be detached/closed rapidly 
        // in high-concurrency animation loops between prop arrival and component mount.
        try {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        } catch (e) {
            // Silently fail - next frame will fix it.
            // console.warn('[AnimatedPreview] Skipping detached frame');
        }

        // We don't close the bitmap here because it might be shared 
        // or needed elsewhere, but ThumbnailService generates new ones.
    }, [bitmap]);

    return (
        <div style={{
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
                    objectFit: 'contain',
                    border: isSelected ? '2px solid #1677ff' : 'none',
                    boxSizing: 'border-box'
                }}
            />
            {!bitmap && (
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
