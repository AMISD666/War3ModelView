import {
  getBoundsDiagonal,
  selectTrustedModelBounds,
  type ModelBounds,
  type ModelBoundsSource,
} from "../../utils/modelBounds";

export type { ModelBounds, ModelBoundsSource };
export { getBoundsDiagonal, selectTrustedModelBounds };

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
    geometryIgnoredVertexCount: boundsSelection.geometryBounds?.ignoredVertexCount,
    geometrySource: boundsSelection.geometryBounds?.source,
  });
  void debug(`[Viewer] fit bounds fallback ${JSON.stringify({
    reason: boundsSelection.fallbackReason,
    modelPath,
    infoDiagonal,
    geometryDiagonal,
    geometryVertexCount: boundsSelection.geometryBounds?.vertexCount,
    geometryIgnoredVertexCount: boundsSelection.geometryBounds?.ignoredVertexCount,
    geometrySource: boundsSelection.geometryBounds?.source,
  })}`, "red");
};
