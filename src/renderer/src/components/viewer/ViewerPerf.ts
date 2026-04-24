export type ViewerFramePerfSample = {
  totalMs: number;
  clearMs: number;
  cameraMs: number;
  stateMs: number;
  updateMs: number;
  sceneMs: number;
  overlayMs: number;
};

export type ViewerFramePerfAggregate = {
  samples: number;
  totalMs: number;
  maxTotalMs: number;
  slowFrameCount: number;
  clearMs: number;
  cameraMs: number;
  stateMs: number;
  updateMs: number;
  sceneMs: number;
  overlayMs: number;
  lastSlowEmitMs: number;
};

export const createViewerFramePerfAggregate = (): ViewerFramePerfAggregate => ({
  samples: 0,
  totalMs: 0,
  maxTotalMs: 0,
  slowFrameCount: 0,
  clearMs: 0,
  cameraMs: 0,
  stateMs: 0,
  updateMs: 0,
  sceneMs: 0,
  overlayMs: 0,
  lastSlowEmitMs: 0,
});

export const roundPerfValue = (value: number): number => Number(value.toFixed(2));
