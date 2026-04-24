import type { vec3 } from "gl-matrix";

export type HealthBarState = {
  sequenceIndex: number;
  sequenceName: string;
  minimumExtent: [number, number, number];
  maximumExtent: [number, number, number];
  center: [number, number, number];
  width: number;
  thickness: number;
};

export type HealthBarDragSnapshot = {
  sequenceIndex: number;
  minimumExtent: [number, number, number];
  maximumExtent: [number, number, number];
};

const HEALTH_BAR_MIN_WIDTH = 18;
const HEALTH_BAR_MAX_WIDTH = 84;
const HEALTH_BAR_MIN_THICKNESS = 4;
const HEALTH_BAR_MAX_THICKNESS = 10;

const toExtentTuple = (value: any): [number, number, number] => {
  const source = Array.isArray(value) || ArrayBuffer.isView(value) ? Array.from(value as ArrayLike<number>) : [];
  return [Number(source[0] ?? 0) || 0, Number(source[1] ?? 0) || 0, Number(source[2] ?? 0) || 0];
};

export const resolveHealthBarState = (sequences: any[]): HealthBarState | null => {
  if (!Array.isArray(sequences) || sequences.length === 0) return null;

  const standIndex = sequences.findIndex((seq) => /stand/i.test(String(seq?.Name ?? seq?.name ?? "")));
  const sequenceIndex = standIndex >= 0 ? standIndex : 0;
  const sequence = sequences[sequenceIndex];
  const minimumExtent = toExtentTuple(sequence?.MinimumExtent);
  const maximumExtent = toExtentTuple(sequence?.MaximumExtent);
  const spanX = Math.abs(maximumExtent[0] - minimumExtent[0]);
  const spanY = Math.abs(maximumExtent[1] - minimumExtent[1]);
  const widthBasis = Math.max(spanX, spanY);
  const width = Math.max(HEALTH_BAR_MIN_WIDTH, Math.min(HEALTH_BAR_MAX_WIDTH, widthBasis * 0.58));
  const thickness = Math.max(HEALTH_BAR_MIN_THICKNESS, Math.min(HEALTH_BAR_MAX_THICKNESS, width * 0.08));

  return {
    sequenceIndex,
    sequenceName: String(sequence?.Name ?? sequence?.name ?? `Sequence ${sequenceIndex + 1}`),
    minimumExtent,
    maximumExtent,
    center: [0, 0, maximumExtent[2]],
    width,
    thickness,
  };
};

export const applyHealthBarOffset = (state: HealthBarState, offset: vec3): HealthBarState => ({
  ...state,
  minimumExtent: [state.minimumExtent[0] + offset[0], state.minimumExtent[1] + offset[1], state.minimumExtent[2] + offset[2]],
  maximumExtent: [state.maximumExtent[0] + offset[0], state.maximumExtent[1] + offset[1], state.maximumExtent[2] + offset[2]],
  center: [state.center[0] + offset[0], state.center[1] + offset[1], state.center[2] + offset[2]],
});
