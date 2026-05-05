export type ModelBoundsSource = "info-extent" | "info-minmax" | "radius" | "geosets";

export type ModelBounds = {
  min: [number, number, number];
  max: [number, number, number];
  source: ModelBoundsSource;
  vertexCount?: number;
};

const MODEL_BOUNDS_EPSILON = 1e-5;
const MAX_TRUSTED_MODEL_DIAGONAL = 1_000_000;
const MAX_INFO_TO_GEOMETRY_DIAGONAL_RATIO = 100;

const readVec3 = (v: unknown): [number, number, number] | null => {
  if (!v) return null;
  const source = v as ArrayLike<unknown>;
  const a0 = Number(source[0]);
  const a1 = Number(source[1]);
  const a2 = Number(source[2]);
  if (!Number.isFinite(a0) || !Number.isFinite(a1) || !Number.isFinite(a2)) return null;
  return [a0, a1, a2];
};

export const getBoundsDiagonal = (bounds: Pick<ModelBounds, "min" | "max">): number => {
  const dx = bounds.max[0] - bounds.min[0];
  const dy = bounds.max[1] - bounds.min[1];
  const dz = bounds.max[2] - bounds.min[2];
  return Math.hypot(dx, dy, dz);
};

const isUsableBounds = (bounds: Pick<ModelBounds, "min" | "max"> | null): bounds is Pick<ModelBounds, "min" | "max"> => {
  if (!bounds) return false;
  for (let i = 0; i < 3; i++) {
    if (!Number.isFinite(bounds.min[i]) || !Number.isFinite(bounds.max[i])) return false;
    if (bounds.min[i] > bounds.max[i]) return false;
  }
  const diagonal = getBoundsDiagonal(bounds);
  return Number.isFinite(diagonal) && diagonal > MODEL_BOUNDS_EPSILON && diagonal <= MAX_TRUSTED_MODEL_DIAGONAL;
};

const createModelBounds = (
  min: [number, number, number],
  max: [number, number, number],
  source: ModelBoundsSource,
  vertexCount?: number
): ModelBounds | null => {
  const bounds: ModelBounds = { min, max, source };
  if (vertexCount !== undefined) bounds.vertexCount = vertexCount;
  return isUsableBounds(bounds) ? bounds : null;
};

const getGeosetModelBounds = (geosets: unknown): ModelBounds | null => {
  if (!Array.isArray(geosets) || geosets.length === 0) return null;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  let vertexCount = 0;

  for (const geoset of geosets) {
    const vertices = (geoset as { Vertices?: ArrayLike<unknown> } | null)?.Vertices;
    if (!vertices || typeof vertices.length !== "number") continue;

    for (let i = 0; i + 2 < vertices.length; i += 3) {
      const x = Number(vertices[i]);
      const y = Number(vertices[i + 1]);
      const z = Number(vertices[i + 2]);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;

      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      maxZ = Math.max(maxZ, z);
      vertexCount++;
    }
  }

  if (vertexCount === 0) return null;
  return createModelBounds([minX, minY, minZ], [maxX, maxY, maxZ], "geosets", vertexCount);
};

const getModelMinMax = (info: unknown): ModelBounds | null => {
  const typedInfo = info as {
    Extent?: { Min?: unknown; Max?: unknown };
    MinimumExtent?: unknown;
    MaximumExtent?: unknown;
    BoundsRadius?: unknown;
  } | null;
  const extentMin = readVec3(typedInfo?.Extent?.Min);
  const extentMax = readVec3(typedInfo?.Extent?.Max);
  if (extentMin && extentMax) {
    const bounds = createModelBounds(extentMin, extentMax, "info-extent");
    if (bounds) return bounds;
  }

  const min = readVec3(typedInfo?.MinimumExtent);
  const max = readVec3(typedInfo?.MaximumExtent);
  if (min && max) {
    const bounds = createModelBounds(min, max, "info-minmax");
    if (bounds) return bounds;
  }

  const r = Number(typedInfo?.BoundsRadius);
  if (Number.isFinite(r) && r > 0) {
    return createModelBounds([-r, -r, -r], [r, r, r], "radius");
  }
  return null;
};

export const selectTrustedModelBounds = (rendererModel: unknown): {
  bounds: ModelBounds | null;
  infoBounds: ModelBounds | null;
  geometryBounds: ModelBounds | null;
  fallbackReason: string | null;
} => {
  const model = rendererModel as { Info?: unknown; Geosets?: unknown } | null;
  const infoBounds = getModelMinMax(model?.Info);
  const geometryBounds = getGeosetModelBounds(model?.Geosets);

  if (!infoBounds) {
    return {
      bounds: geometryBounds,
      infoBounds,
      geometryBounds,
      fallbackReason: geometryBounds ? "missing-or-invalid-info-bounds" : null,
    };
  }

  if (geometryBounds) {
    const infoDiagonal = getBoundsDiagonal(infoBounds);
    const geometryDiagonal = getBoundsDiagonal(geometryBounds);
    if (
      geometryDiagonal > MODEL_BOUNDS_EPSILON &&
      infoDiagonal / geometryDiagonal > MAX_INFO_TO_GEOMETRY_DIAGONAL_RATIO
    ) {
      return {
        bounds: geometryBounds,
        infoBounds,
        geometryBounds,
        fallbackReason: "info-bounds-too-large-for-geometry",
      };
    }
  }

  return { bounds: infoBounds, infoBounds, geometryBounds, fallbackReason: null };
};

export const reportModelBoundsFallback = (
  boundsSelection: {
    infoBounds: ModelBounds | null;
    geometryBounds: ModelBounds | null;
    fallbackReason: string | null;
  },
  modelPath: string | null | undefined,
  debug: (message: string, color?: "green" | "red") => Promise<unknown> | unknown,
) => {
  const infoDiagonal = boundsSelection.infoBounds ? getBoundsDiagonal(boundsSelection.infoBounds) : null;
  const geometryDiagonal = boundsSelection.geometryBounds ? getBoundsDiagonal(boundsSelection.geometryBounds) : null;
  console.warn("[Viewer] Ignoring unreliable model extents for camera fit:", {
    reason: boundsSelection.fallbackReason,
    modelPath,
    infoBounds: boundsSelection.infoBounds,
    geometryBounds: boundsSelection.geometryBounds,
    infoDiagonal,
    geometryDiagonal,
  });
  void debug(`[Viewer] fit bounds fallback ${JSON.stringify({
    reason: boundsSelection.fallbackReason,
    modelPath,
    infoDiagonal,
    geometryDiagonal,
    geometryVertexCount: boundsSelection.geometryBounds?.vertexCount,
  })}`, "red");
};
