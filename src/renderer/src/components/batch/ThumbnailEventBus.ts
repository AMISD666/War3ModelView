/**
 * ThumbnailEventBus - A lightweight event bus to decouple thumbnail updates
 * from React's central state. This prevents the entire grid from re-rendering
 * 240+ times per second.
 */
class ThumbnailEventBus {
    private listeners: Map<string, Set<Function>> = new Map();
    private bitmaps: Map<string, ImageBitmap> = new Map();
    private graveyard: Map<string, ImageBitmap> = new Map(); // Keep last frame alive to prevent React race conditions
    private animations: Map<string, string[]> = new Map();

    public on(event: string, callback: Function) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event)!.add(callback);
    }

    public off(event: string, callback: Function) {
        this.listeners.get(event)?.delete(callback);
    }

    private emit(event: string, ...args: any[]) {
        this.listeners.get(event)?.forEach(cb => cb(...args));
    }

    public emitThumbnail(fullPath: string, bitmap: ImageBitmap) {
        // Memory management: move current to graveyard, close previous graveyard item
        const current = this.bitmaps.get(fullPath);
        if (current && current !== bitmap) {
            const old = this.graveyard.get(fullPath);
            if (old) {
                try { old.close(); } catch (e) { }
            }
            this.graveyard.set(fullPath, current);
        }

        this.bitmaps.set(fullPath, bitmap);
        this.emit(`update:${fullPath}`, bitmap);
    }

    public emitAnimations(fullPath: string, animations: string[]) {
        this.animations.set(fullPath, animations);
        this.emit(`animations:${fullPath}`, animations);
    }

    public getBitmap(fullPath: string): ImageBitmap | undefined {
        return this.bitmaps.get(fullPath);
    }

    public getAnimations(fullPath: string): string[] | undefined {
        return this.animations.get(fullPath);
    }

    public clear() {
        this.bitmaps.forEach(b => {
            try { b.close(); } catch (e) { }
        });
        this.graveyard.forEach(b => {
            try { b.close(); } catch (e) { }
        });
        this.bitmaps.clear();
        this.graveyard.clear();
        this.animations.clear();
        this.listeners.clear();
    }
}

export const thumbnailEventBus = new ThumbnailEventBus();
