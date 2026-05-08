import type { TextureAdjustments } from "../../utils/textureAdjustments";
import { TEXTURE_ADJUSTMENTS_KEY, normalizeTextureAdjustments } from "../../utils/textureAdjustments";
import { normalizePath, REPLACEABLE_TEXTURES } from "./textureLoader";
import type { TextureLoadResult } from "./textureLoader";

export type LiveTextureAdjustPayload = {
  modelPath: string;
  imagePath: string;
  assetRevision?: number;
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

const addReferencedTexturePath = (paths: Set<string>, path: unknown): void => {
  if (typeof path !== "string") return;
  const normalized = normalizePath(path);
  if (normalized) paths.add(normalized);
};

export const collectReferencedTexturePaths = (model: any): Set<string> => {
  const paths = new Set<string>();
  if (Array.isArray(model?.Textures)) {
    model.Textures.forEach((texture: any) => addReferencedTexturePath(paths, texture?.Image));
  }
  if (Array.isArray(model?.ParticleEmitters)) {
    model.ParticleEmitters.forEach((emitter: any) => addReferencedTexturePath(paths, emitter?.FileName));
  }
  if (Array.isArray(model?.ParticleEmitters2)) {
    model.ParticleEmitters2.forEach((emitter: any) => {
      if (emitter?.ReplaceableId > 0 && (emitter.TextureID === -1 || emitter.TextureID === undefined)) {
        const replaceablePath = REPLACEABLE_TEXTURES[emitter.ReplaceableId];
        if (replaceablePath !== undefined) {
          addReferencedTexturePath(paths, `ReplaceableTextures\\${replaceablePath}.blp`);
        }
      }
    });
  }
  return paths;
};

export const updateMissingTexturePathsAfterLoad = (
  currentMissing: string[],
  referencedPaths: Set<string>,
  results: TextureLoadResult[],
): string[] => {
  const next = new Set<string>();
  for (const path of currentMissing) {
    const normalized = normalizePath(path);
    if (normalized && referencedPaths.has(normalized)) {
      next.add(normalized);
    }
  }
  for (const result of results) {
    const normalized = normalizePath(result.path);
    if (!normalized || !referencedPaths.has(normalized)) continue;
    if (result.loaded) {
      next.delete(normalized);
    } else {
      next.add(normalized);
    }
  }
  return Array.from(next);
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

export const getLiveTextureSourceKey = (modelPath: string, imagePath: string, assetRevision?: number): string =>
  `${modelPath || ""}::${assetRevision ?? 0}::${normalizePath(imagePath || "")}`;

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

const TEXTURE_PREVIEW_EXTENSIONS = new Set(["blp", "tga", "png", "jpg", "jpeg", "webp", "gif", "bmp"]);

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
