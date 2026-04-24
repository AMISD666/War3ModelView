export interface ViewerRef {
  fitToView: () => void;
  getCamera: () => { distance: number; theta: number; phi: number; target: [number, number, number] };
  setCamera: (params: { distance: number; theta: number; phi: number; target: [number, number, number] }) => void;
}

export interface ViewerProps {
  modelPath: string | null;
  animationIndex: number;
  teamColor: number;
  showGrid: boolean;
  showNodes: boolean;
  showSkeleton: boolean;
  showCollisionShapes: boolean;
  showCameras: boolean;
  showLights: boolean;
  showAttachments?: boolean;
  showWireframe: boolean;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onToggleLooping?: () => void;
  onToggleWireframe: () => void;
  onModelLoaded: (model: any) => void;
  backgroundColor: string;
  showFPS: boolean;
  playbackSpeed: number;
  viewPreset?: { type: string; time: number; reset?: boolean } | null;
  onSetViewPreset?: (preset: string) => void;
  onAddCameraFromView?: () => void;
  modelData?: any;
}
