type ViewerRenderDiagnosticModel = {
  Geosets?: Array<{ MaterialID?: unknown; Faces?: ArrayLike<number> }>;
  Materials?: Array<{ Layers?: unknown[] }>;
  Textures?: unknown[];
  __modelPath?: unknown;
  path?: unknown;
};

type ViewerRenderDiagnosticData = {
  frame?: unknown;
  animationInfo?: { Name?: unknown };
  materialLayerTextureID?: unknown[][];
};

export type ViewerRenderDiagnosticRenderer = {
  model?: ViewerRenderDiagnosticModel;
  rendererData?: ViewerRenderDiagnosticData;
  __modelPath?: unknown;
};

export const getViewerRenderDiagnostics = (
  currentRenderer: ViewerRenderDiagnosticRenderer | null | undefined,
  modelPath: string | null | undefined,
  stage: string,
  gl?: WebGLRenderingContext | WebGL2RenderingContext | null,
) => {
  const rendererModel = currentRenderer?.model;
  const rendererData = currentRenderer?.rendererData;
  const materialCount = Array.isArray(rendererModel?.Materials) ? rendererModel.Materials.length : 0;
  const textureCount = Array.isArray(rendererModel?.Textures) ? rendererModel.Textures.length : 0;
  let firstInvalidTextureRef: Record<string, unknown> | null = null;

  if (rendererModel && rendererData && Array.isArray(rendererModel.Geosets) && Array.isArray(rendererModel.Materials) && Array.isArray(rendererData.materialLayerTextureID)) {
    for (let geosetIndex = 0; geosetIndex < rendererModel.Geosets.length && !firstInvalidTextureRef; geosetIndex++) {
      const materialId = Number(rendererModel.Geosets[geosetIndex]?.MaterialID);
      if (!Number.isInteger(materialId) || materialId < 0 || materialId >= rendererModel.Materials.length) continue;
      const layers = rendererModel.Materials[materialId]?.Layers;
      const cachedTextureIds = rendererData.materialLayerTextureID[materialId];
      if (!Array.isArray(layers) || !Array.isArray(cachedTextureIds)) continue;
      for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
        const textureId = Number(cachedTextureIds[layerIndex]);
        if (!Number.isInteger(textureId) || textureId < 0 || textureId >= textureCount) {
          firstInvalidTextureRef = { geosetIndex, materialId, layerIndex, textureId, textureCount };
          break;
        }
      }
    }
  }

  const rendererModelPath =
    (typeof currentRenderer?.__modelPath === 'string' && currentRenderer.__modelPath) ||
    (typeof rendererModel?.__modelPath === 'string' && rendererModel.__modelPath) ||
    (typeof rendererModel?.path === 'string' && rendererModel.path) ||
    '';

  return {
    stage,
    modelPath: modelPath || rendererModelPath,
    geosetCount: Array.isArray(rendererModel?.Geosets) ? rendererModel.Geosets.length : 0,
    materialCount,
    textureCount,
    currentSequence: rendererData?.animationInfo?.Name,
    currentFrame: rendererData?.frame,
    firstInvalidTextureRef,
    glError: gl ? gl.getError() : undefined,
  };
};

export const reportViewerRenderError = (
  error: unknown,
  options: {
    renderer: ViewerRenderDiagnosticRenderer | null | undefined;
    modelPath: string | null | undefined;
    stage: string;
    consolePrefix: string;
    contextPrefix: string;
    perfName: string;
    gl?: WebGLRenderingContext | WebGL2RenderingContext | null;
    debug: (message: string, color?: "green" | "red") => Promise<unknown> | unknown;
    markPerf: (name: string, detail?: Record<string, unknown>) => void;
  },
) => {
  const context = getViewerRenderDiagnostics(options.renderer, options.modelPath, options.stage, options.gl);
  const message = error instanceof Error ? `${error.name}: ${error.message}${error.stack ? `\n${error.stack}` : ""}` : String(error);
  console.error(options.consolePrefix, error);
  console.error(options.contextPrefix, context);
  void options.debug(`[Viewer] ${options.stage} ${JSON.stringify(context)}\n${message}`, "red");
  options.markPerf(options.perfName, {
    ...context,
    message: error instanceof Error ? error.message : String(error),
  });
};
