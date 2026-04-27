const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
    '.bmp': 'image/bmp',
    '.gif': 'image/gif',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
}

const getImageMimeType = (path: string): string => {
    const lower = path.toLowerCase()
    const match = Object.keys(IMAGE_MIME_BY_EXTENSION).find((extension) => lower.endsWith(extension))
    return match ? IMAGE_MIME_BY_EXTENSION[match] : 'application/octet-stream'
}

export const createImageDataUrlFromBytes = (bytes: Uint8Array, path: string): Promise<string> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader()
        const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
        reader.onload = () => {
            if (typeof reader.result === 'string') {
                resolve(reader.result)
                return
            }
            reject(new Error('Failed to create image data URL'))
        }
        reader.onerror = () => reject(reader.error ?? new Error('Failed to read image bytes'))
        reader.readAsDataURL(new Blob([buffer], { type: getImageMimeType(path) }))
    })
