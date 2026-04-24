import type { TextureAdjustments } from "../../utils/textureAdjustments";
import { TEXTURE_ADJUSTMENTS_KEY, normalizeTextureAdjustments } from "../../utils/textureAdjustments";
import { normalizePath } from "./textureLoader";

export type LiveTextureAdjustPayload = {
  modelPath: string;
  imagePath: string;
  adjustments: TextureAdjustments;
};

export type TextureReloadRequest = {
  renderer: any;
  modelPath: string;
  targetPaths: string[];
  version: number;
};

export type TextureReloadSchedulerState = {
  timer: ReturnType<typeof setTimeout> | null;
  running: boolean;
  queued: TextureReloadRequest | null;
  version: number;
};

export const toTextureUpdateUint8Array = (payload: any): Uint8ClampedArray | null => {
  if (!payload) return null;
  if (payload instanceof Uint8ClampedArray) return payload;
  if (payload instanceof Uint8Array) return new Uint8ClampedArray(payload.buffer, payload.byteOffset, payload.byteLength);
  if (payload instanceof ArrayBuffer) return new Uint8ClampedArray(payload);
  if (ArrayBuffer.isView(payload)) {
    return new Uint8ClampedArray(payload.buffer, payload.byteOffset, payload.byteLength);
  }
  if (Array.isArray(payload)) return new Uint8ClampedArray(payload);
  return null;
};

export const getLiveTextureSourceKey = (modelPath: string, imagePath: string): string => `${modelPath || ""}::${normalizePath(imagePath || "")}`;

export const getTextureAdjustmentSignature = (texture: any): string => {
  const raw = texture?.[TEXTURE_ADJUSTMENTS_KEY];
  if (!raw) return "";
  const normalized = normalizeTextureAdjustments(raw);
  return [normalized.hue, normalized.brightness, normalized.saturation, normalized.opacity, normalized.colorize ? 1 : 0].join("|");
};

export const toUint8Array = (payload: any): Uint8Array | null => {
  if (!payload) return null;
  if (payload instanceof Uint8Array) return payload;
  if (payload instanceof ArrayBuffer) return new Uint8Array(payload);
  if (ArrayBuffer.isView(payload)) {
    return new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
  }
  if (Array.isArray(payload)) {
    return new Uint8Array(payload);
  }
  if (typeof payload === "string") {
    try {
      const binary = atob(payload);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes;
    } catch {
      return null;
    }
  }
  if (typeof payload === "object") {
    const candidate = (payload as any).data ?? (payload as any).bytes ?? (payload as any).payload;
    if (candidate !== undefined) {
      return toUint8Array(candidate);
    }
    const numericKeys = Object.keys(payload)
      .filter((k) => /^d+$/.test(k))
      .sort((a, b) => Number(a) - Number(b));
    if (numericKeys.length > 0) {
      const bytes = new Uint8Array(numericKeys.length);
      for (let i = 0; i < numericKeys.length; i++) {
        bytes[i] = Number((payload as any)[numericKeys[i]]) & 0xff;
      }
      return bytes;
    }
  }
  return null;
};

export const toTightArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  if (bytes.buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer;
  }
  if (bytes.buffer instanceof ArrayBuffer) {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }
  return bytes.slice().buffer;
};

const TEXTURE_PREVIEW_EXTENSIONS = new Set(["blp", "tga"]);

export const isTexturePreviewPath = (path: string): boolean => {
  const lower = path.toLowerCase();
  const dotIndex = lower.lastIndexOf(".");
  if (dotIndex < 0) return false;
  const ext = lower.substring(dotIndex + 1);
  return TEXTURE_PREVIEW_EXTENSIONS.has(ext);
};

export const getTextureDecodeWorkerCount = (): number => {
  if (typeof navigator === "undefined") return 2;
  const cores = Number(navigator.hardwareConcurrency || 4);
  if (!Number.isFinite(cores) || cores <= 2) return 2;
  return Math.max(2, Math.min(6, Math.floor(cores / 2)));
};
