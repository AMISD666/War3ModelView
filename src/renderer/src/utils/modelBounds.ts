export type ModelBoundsSource = "info-extent" | "info-minmax" | "radius" | "geosets" | "geosets-filtered";

export type ModelBounds = {
    min: [number, number, number];
    max: [number, number, number];
    source: ModelBoundsSource;
    vertexCount?: number;
    ignoredVertexCount?: number;
};

export const MODEL_BOUNDS_EPSILON = 1e-5;
export const MAX_TRUSTED_MODEL_DIAGONAL = 1_000_000;
export const MAX_INFO_TO_GEOMETRY_DIAGONAL_RATIO = 100;

const MIN_OUTLIER_FILTER_VERTEX_COUNT = 8;
const MAX_IGNORED_VERTEX_SHARE = 0.2;
const MIN_FILTERED_DIAGONAL_RATIO = 3;
const MIN_OUTLIER_DISTANCE_RATIO = 3;

type Vec3Tuple = [number, number, number];

type BoundsBuildResult = {
    min: Vec3Tuple;
    max: Vec3Tuple;
    vertexCount: number;
};

type VertexSourceResult = {
    vertices: Vec3Tuple[];
    ignoredVertexCount: number;
};

const readVec3 = (value: unknown): Vec3Tuple | null => {
    if (!value) return null;
    const source = value as ArrayLike<unknown>;
    const x = Number(source[0]);
    const y = Number(source[1]);
    const z = Number(source[2]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    return [x, y, z];
};

const getVertexCount = (vertices: unknown): number => {
    if (!vertices || typeof (vertices as { length?: unknown }).length !== "number") return 0;
    if (Array.isArray(vertices) && Array.isArray(vertices[0])) return vertices.length;
    return Math.floor(Number((vertices as { length: number }).length) / 3);
};

const readVertex = (vertices: unknown, index: number): Vec3Tuple | null => {
    if (Array.isArray(vertices) && Array.isArray(vertices[index])) {
        return readVec3(vertices[index]);
    }

    const source = vertices as ArrayLike<unknown>;
    const base = index * 3;
    return readVec3([source?.[base], source?.[base + 1], source?.[base + 2]]);
};

const buildBounds = (vertices: Vec3Tuple[]): BoundsBuildResult | null => {
    if (vertices.length === 0) return null;

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;

    for (const [x, y, z] of vertices) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        minZ = Math.min(minZ, z);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        maxZ = Math.max(maxZ, z);
    }

    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(minZ)) return null;
    return {
        min: [minX, minY, minZ],
        max: [maxX, maxY, maxZ],
        vertexCount: vertices.length,
    };
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
    min: Vec3Tuple,
    max: Vec3Tuple,
    source: ModelBoundsSource,
    vertexCount?: number,
    ignoredVertexCount?: number,
): ModelBounds | null => {
    const bounds: ModelBounds = { min, max, source };
    if (vertexCount !== undefined) bounds.vertexCount = vertexCount;
    if (ignoredVertexCount !== undefined && ignoredVertexCount > 0) bounds.ignoredVertexCount = ignoredVertexCount;
    return isUsableBounds(bounds) ? bounds : null;
};

const quantile = (sortedValues: number[], ratio: number): number => {
    if (sortedValues.length === 0) return 0;
    if (sortedValues.length === 1) return sortedValues[0];

    const clampedRatio = Math.min(1, Math.max(0, ratio));
    const position = (sortedValues.length - 1) * clampedRatio;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    if (lower === upper) return sortedValues[lower];
    const weight = position - lower;
    return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
};

const buildReferencedVertexMask = (faces: unknown, vertexCount: number): Uint8Array | null => {
    if (!faces || typeof (faces as { length?: unknown }).length !== "number" || vertexCount <= 0) return null;

    const source = faces as ArrayLike<unknown>;
    const referenced = new Uint8Array(vertexCount);
    let referencedCount = 0;

    for (let i = 0; i < Number(source.length); i++) {
        const index = Number(source[i]);
        if (!Number.isInteger(index) || index < 0 || index >= vertexCount) continue;
        if (referenced[index] === 0) {
            referenced[index] = 1;
            referencedCount++;
        }
    }

    return referencedCount >= 3 ? referenced : null;
};

const collectGeosetVertices = (geoset: unknown): VertexSourceResult => {
    const typedGeoset = geoset as { Vertices?: unknown; Faces?: unknown } | null;
    const vertices = typedGeoset?.Vertices;
    const vertexCount = getVertexCount(vertices);
    if (!vertices || vertexCount === 0) {
        return { vertices: [], ignoredVertexCount: 0 };
    }

    const referencedMask = buildReferencedVertexMask(typedGeoset?.Faces, vertexCount);
    const result: Vec3Tuple[] = [];
    let ignoredVertexCount = 0;

    for (let index = 0; index < vertexCount; index++) {
        if (referencedMask && referencedMask[index] === 0) {
            ignoredVertexCount++;
            continue;
        }

        const vertex = readVertex(vertices, index);
        if (!vertex) continue;
        result.push(vertex);
    }

    return { vertices: result, ignoredVertexCount };
};

const buildMedianCenter = (vertices: Vec3Tuple[]): Vec3Tuple => {
    const xs = vertices.map((vertex) => vertex[0]).sort((a, b) => a - b);
    const ys = vertices.map((vertex) => vertex[1]).sort((a, b) => a - b);
    const zs = vertices.map((vertex) => vertex[2]).sort((a, b) => a - b);
    return [
        quantile(xs, 0.5),
        quantile(ys, 0.5),
        quantile(zs, 0.5),
    ];
};

const filterSpatialOutliers = (vertices: Vec3Tuple[]): { filtered: Vec3Tuple[]; ignoredVertexCount: number } | null => {
    if (vertices.length < MIN_OUTLIER_FILTER_VERTEX_COUNT) return null;

    const center = buildMedianCenter(vertices);
    const distances = vertices.map((vertex) => Math.hypot(vertex[0] - center[0], vertex[1] - center[1], vertex[2] - center[2]));
    const sortedDistances = [...distances].sort((a, b) => a - b);
    const medianDistance = quantile(sortedDistances, 0.5);
    const distance75 = quantile(sortedDistances, 0.75);
    const distance90 = quantile(sortedDistances, 0.9);
    const maxDistance = sortedDistances[sortedDistances.length - 1] ?? 0;
    const deviations = distances
        .map((distance) => Math.abs(distance - medianDistance))
        .sort((a, b) => a - b);
    const mad = quantile(deviations, 0.5);

    const threshold = Math.max(
        distance75 * 6,
        distance90 * 2,
        medianDistance + Math.max(mad * 12, distance75 * 1.5),
    );

    if (!Number.isFinite(threshold) || threshold <= MODEL_BOUNDS_EPSILON) return null;
    if (maxDistance < threshold * MIN_OUTLIER_DISTANCE_RATIO) return null;

    const filtered = vertices.filter((_, index) => distances[index] <= threshold);
    const ignoredVertexCount = vertices.length - filtered.length;
    if (ignoredVertexCount <= 0) return null;
    if (ignoredVertexCount > Math.max(4, Math.ceil(vertices.length * MAX_IGNORED_VERTEX_SHARE))) return null;
    if (filtered.length < Math.max(6, Math.ceil(vertices.length * 0.6))) return null;

    const rawBounds = buildBounds(vertices);
    const filteredBounds = buildBounds(filtered);
    if (!rawBounds || !filteredBounds) return null;

    const rawDiagonal = getBoundsDiagonal(rawBounds);
    const filteredDiagonal = getBoundsDiagonal(filteredBounds);
    if (filteredDiagonal <= MODEL_BOUNDS_EPSILON) return null;
    if (rawDiagonal / filteredDiagonal < MIN_FILTERED_DIAGONAL_RATIO) return null;

    return { filtered, ignoredVertexCount };
};

const buildFilteredGeometryBounds = (vertices: Vec3Tuple[], baseIgnoredVertexCount: number): ModelBounds | null => {
    const rawBounds = buildBounds(vertices);
    if (!rawBounds) return null;

    const filtered = filterSpatialOutliers(vertices);
    if (!filtered) {
        return createModelBounds(rawBounds.min, rawBounds.max, "geosets", rawBounds.vertexCount, baseIgnoredVertexCount);
    }

    const filteredBounds = buildBounds(filtered.filtered);
    if (!filteredBounds) {
        return createModelBounds(rawBounds.min, rawBounds.max, "geosets", rawBounds.vertexCount, baseIgnoredVertexCount);
    }

    return createModelBounds(
        filteredBounds.min,
        filteredBounds.max,
        "geosets-filtered",
        filteredBounds.vertexCount,
        baseIgnoredVertexCount + filtered.ignoredVertexCount,
    );
};

const getModelInfoBounds = (info: unknown): ModelBounds | null => {
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

    const radius = Number(typedInfo?.BoundsRadius);
    if (Number.isFinite(radius) && radius > 0) {
        return createModelBounds([-radius, -radius, -radius], [radius, radius, radius], "radius");
    }

    return null;
};

export const getTrustedGeosetBounds = (geoset: unknown): ModelBounds | null => {
    const typedGeoset = geoset as { Vertices?: unknown } | null;
    const vertices = typedGeoset?.Vertices;
    const vertexCount = getVertexCount(vertices);
    if (!vertices || vertexCount === 0) return null;

    const collected: Vec3Tuple[] = [];
    for (let index = 0; index < vertexCount; index++) {
        const vertex = readVertex(vertices, index);
        if (!vertex) continue;
        collected.push(vertex);
    }

    const rawBounds = buildBounds(collected);
    if (!rawBounds) return null;
    return createModelBounds(rawBounds.min, rawBounds.max, "geosets", rawBounds.vertexCount);
};

export const getTrustedModelGeometryBounds = (geosets: unknown): ModelBounds | null => {
    if (!Array.isArray(geosets) || geosets.length === 0) return null;

    const vertices: Vec3Tuple[] = [];
    let ignoredVertexCount = 0;

    for (const geoset of geosets) {
        const collected = collectGeosetVertices(geoset);
        vertices.push(...collected.vertices);
        ignoredVertexCount += collected.ignoredVertexCount;
    }

    return buildFilteredGeometryBounds(vertices, ignoredVertexCount);
};

export const selectTrustedModelBounds = (rendererModel: unknown): {
    bounds: ModelBounds | null;
    infoBounds: ModelBounds | null;
    geometryBounds: ModelBounds | null;
    fallbackReason: string | null;
} => {
    const model = rendererModel as { Info?: unknown; Geosets?: unknown } | null;
    const infoBounds = getModelInfoBounds(model?.Info);
    const geometryBounds = getTrustedModelGeometryBounds(model?.Geosets);

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
