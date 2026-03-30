const DB_NAME = 'war3modelview-thumbnail-animation-cache';
const STORE_NAME = 'clips';
const DB_VERSION = 1;
const FRAME_TARGET = 8;
const FRAME_FORMAT = 'image/webp';
const FRAME_QUALITY = 0.8;

type ClipRecord = {
    key: string;
    updatedAt: number;
    frames: ArrayBuffer[];
};

class ThumbnailAnimationCache {
    private dbPromise: Promise<IDBDatabase> | null = null;
    private pendingFrames = new Map<string, ArrayBuffer[]>();
    private savingKeys = new Set<string>();
    private memoryClips = new Map<string, ImageBitmap[]>();
    private loadingClips = new Map<string, Promise<ImageBitmap[] | null>>();
    private knownPersistedKeys = new Set<string>();

    private openDb(): Promise<IDBDatabase> {
        if (this.dbPromise) {
            return this.dbPromise;
        }

        this.dbPromise = new Promise((resolve, reject) => {
            if (typeof indexedDB === 'undefined') {
                reject(new Error('indexedDB unavailable'));
                return;
            }

            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'key' });
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || new Error('indexedDB open failed'));
        });

        return this.dbPromise;
    }

    private async bitmapToArrayBuffer(bitmap: ImageBitmap): Promise<ArrayBuffer | null> {
        if (typeof document === 'undefined') {
            return null;
        }

        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d', { alpha: true });
        if (!ctx) {
            return null;
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

        const blob = await new Promise<Blob | null>((resolve) => {
            canvas.toBlob((value) => resolve(value), FRAME_FORMAT, FRAME_QUALITY);
        });
        if (!blob) {
            return null;
        }
        return await blob.arrayBuffer();
    }

    private async writeRecord(key: string, frames: ArrayBuffer[]): Promise<void> {
        const db = await this.openDb();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const record: ClipRecord = {
                key,
                updatedAt: Date.now(),
                frames
            };
            store.put(record);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error || new Error('indexedDB write failed'));
            tx.onabort = () => reject(tx.error || new Error('indexedDB write aborted'));
        });
        this.knownPersistedKeys.add(key);
    }

    private async readRecord(key: string): Promise<ClipRecord | null> {
        const db = await this.openDb();
        return await new Promise<ClipRecord | null>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const request = store.get(key);
            request.onsuccess = () => resolve((request.result as ClipRecord | undefined) || null);
            request.onerror = () => reject(request.error || new Error('indexedDB read failed'));
        });
    }

    public async captureFrame(key: string, bitmap: ImageBitmap): Promise<void> {
        if (!key || typeof window === 'undefined') {
            return;
        }
        if (this.knownPersistedKeys.has(key) || this.savingKeys.has(key)) {
            return;
        }

        const currentFrames = this.pendingFrames.get(key) || [];
        if (currentFrames.length >= FRAME_TARGET) {
            return;
        }

        const encoded = await this.bitmapToArrayBuffer(bitmap);
        if (!encoded || encoded.byteLength === 0) {
            return;
        }

        const nextFrames = currentFrames.concat([encoded]);
        this.pendingFrames.set(key, nextFrames);

        if (nextFrames.length < FRAME_TARGET) {
            return;
        }

        this.savingKeys.add(key);
        this.pendingFrames.delete(key);
        try {
            await this.writeRecord(key, nextFrames);
        } catch {
            // Ignore cache write failures. Runtime rendering remains the source of truth.
        } finally {
            this.savingKeys.delete(key);
        }
    }

    public async loadClip(key: string): Promise<ImageBitmap[] | null> {
        if (!key || typeof window === 'undefined' || typeof createImageBitmap === 'undefined') {
            return null;
        }

        const cached = this.memoryClips.get(key);
        if (cached) {
            return cached;
        }

        const inflight = this.loadingClips.get(key);
        if (inflight) {
            return inflight;
        }

        const loadPromise = (async () => {
            try {
                const record = await this.readRecord(key);
                if (!record || !Array.isArray(record.frames) || record.frames.length === 0) {
                    return null;
                }

                const bitmaps = await Promise.all(record.frames.map(async (frame) => {
                    const blob = new Blob([frame], { type: FRAME_FORMAT });
                    return await createImageBitmap(blob);
                }));
                this.memoryClips.set(key, bitmaps);
                this.knownPersistedKeys.add(key);
                return bitmaps;
            } catch {
                return null;
            } finally {
                this.loadingClips.delete(key);
            }
        })();

        this.loadingClips.set(key, loadPromise);
        return loadPromise;
    }

    public async hasClip(key: string): Promise<boolean> {
        if (!key || typeof window === 'undefined') {
            return false;
        }
        if (this.knownPersistedKeys.has(key) || this.memoryClips.has(key)) {
            return true;
        }
        try {
            const record = await this.readRecord(key);
            if (record && Array.isArray(record.frames) && record.frames.length > 0) {
                this.knownPersistedKeys.add(key);
                return true;
            }
        } catch {
            return false;
        }
        return false;
    }

    public prune(activeKeys: Set<string>): void {
        for (const [key, frames] of this.memoryClips.entries()) {
            if (activeKeys.has(key)) continue;
            for (const frame of frames) {
                try { frame.close(); } catch { }
            }
            this.memoryClips.delete(key);
        }

        for (const key of Array.from(this.pendingFrames.keys())) {
            if (!activeKeys.has(key)) {
                this.pendingFrames.delete(key);
            }
        }
    }
}

export const thumbnailAnimationCache = new ThumbnailAnimationCache();
