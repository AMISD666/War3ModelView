import { mat4 } from "gl-matrix";
import type React from "react";
import { AxisIndicator } from "../AxisIndicator";
import type { ViewerFramePerfSample } from "./ViewerPerf";

export type ViewerRenderRecoveryOptions = {
  axisIndicator: AxisIndicator;
  canvas: HTMLCanvasElement;
  cameraMs: number;
  clearMs: number;
  currentAnimationSubMode: string;
  currentMainMode: string;
  frameCount: React.MutableRefObject<number>;
  framePerfStart: number;
  gl: WebGLRenderingContext | WebGL2RenderingContext | null;
  lastFpsTime: React.MutableRefObject<number>;
  mvMatrix: mat4;
  overlayStageStart: number;
  pMatrix: mat4;
  recordFramePerfSample: (sample: ViewerFramePerfSample, detail?: Record<string, unknown>) => void;
  sceneMs: number;
  setFps: React.Dispatch<React.SetStateAction<number>>;
  stateMs: number;
  time: number;
  transformMode: string;
  updateMs: number;
  playing: boolean;
};

export const finishFailedModelRenderFrame = (options: ViewerRenderRecoveryOptions): void => {
  if (options.gl) {
    options.axisIndicator.render(options.gl as WebGLRenderingContext, options.mvMatrix, options.canvas.width, options.canvas.height);
  }
  const overlayMs = performance.now() - options.overlayStageStart;
  options.frameCount.current++;
  if (options.time - options.lastFpsTime.current >= 1000) {
    options.setFps(Math.round((options.frameCount.current * 1000) / (options.time - options.lastFpsTime.current)));
    options.frameCount.current = 0;
    options.lastFpsTime.current = options.time;
  }
  options.recordFramePerfSample({
    totalMs: performance.now() - options.framePerfStart,
    clearMs: options.clearMs,
    cameraMs: options.cameraMs,
    stateMs: options.stateMs,
    updateMs: options.updateMs,
    sceneMs: options.sceneMs,
    overlayMs,
  }, {
    mainMode: options.currentMainMode,
    animationSubMode: options.currentAnimationSubMode,
    transformMode: options.transformMode || "none",
    playing: options.playing,
    modelRenderFailed: true,
  });
};
