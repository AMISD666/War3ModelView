# AI 交接文档 (AI Handover Document)

**最后更新**: 2025-12-01
**当前版本**: v2.0 (渲染修复与交互优化版)

## 1. 项目概况 (Project Overview)
**项目名称**: War3 Model Editor
**技术栈**: Electron, React, TypeScript, WebGL (Raw), Ant Design, Zustand, Rust (Tauri Backend).
**核心依赖**: 
- `war3-model`: 本地库，负责解析和渲染 MDX/MDL 模型。
- `gl-matrix`: 矩阵数学库。

## 2. 最新进展 (Recent Progress) - 2025/12/01

### ✅ 已修复/已完成 (Fixed/Completed)
1.  **渲染系统修复 (Critical)**:
    *   解决了模型加载黑屏、FPS 为 0 的问题。
    *   **原因**: `war3-model` 纹理加载逻辑访问了未定义的 `.Image` 属性导致崩溃；渲染循环中缺少 `mdlRenderer.setCamera` 调用。
    *   **修复**: 在 `Viewer.tsx` 中重写了纹理加载逻辑（优先 MPQ，后备本地文件），并恢复了正确的渲染调用顺序。
    *   **WebGL 状态**: 添加了 `gl.disableVertexAttribArray` 清理逻辑，防止 Grid 渲染干扰模型渲染。

2.  **交互系统统一 (Interaction Unified)**:
    *   **相机控制**: 所有模式（View/Geometry/Animation）统一操作：
        *   **左键拖拽**: 旋转 (Rotate)
        *   **中键/右键拖拽**: 平移 (Pan)
        *   **滚轮**: 缩放 (Zoom)
    *   **框选逻辑**: 
        *   **Alt + 左键**: 触发框选 (仅在 Geometry 模式)。
        *   普通左键不再触发框选，避免与旋转冲突。

3.  **UI 恢复**:
    *   恢复了动画模式下的 "Bone Binding" 和 "Keyframe" 按钮。

4.  **源代码备份**:
    *   创建了完整的源码备份 `war3-model-editor_source_backup_20251201_1608`。

### 🚧 待办事项 (TODO / Roadmap)
1.  **动画编辑 (Animation Editing)**:
    *   实现关键帧的增删改 (Translation/Rotation/Scaling)。
    *   完善时间轴 UI。
2.  **顶点编辑器 (Vertex Editor)**:
    *   目前已有 UI，但需要实现具体的数值修改逻辑，并同步回模型数据。
3.  **Gizmo 增强**:
    *   实现平面移动 (XY, XZ, YZ 平面)，目前仅支持轴向移动。
4.  **保存功能**:
    *   将修改后的模型数据写回 MDX/MDL 文件 (目前仅支持读取)。

## 3. 核心代码说明 (Core Implementation)

### `src/renderer/src/components/Viewer.tsx`
这是本项目的**心脏**。它包含：
- **WebGL Context 初始化**: `canvasRef` 和 `gl` 上下文。
- **渲染循环 (Render Loop)**: `requestAnimationFrame` 驱动。
- **输入处理**: `handleMouseDown`, `handleMouseMove` (包含相机和 Gizmo 逻辑)。
- **模型加载**: `loadModel` 函数，包含复杂的纹理路径解析逻辑 (MPQ vs Local)。

**关键注意事项**:
- **渲染顺序**: 必须先 `gl.clear` -> 更新相机 -> `mdlRenderer.setCamera` -> `mdlRenderer.render`。顺序错误会导致黑屏。
- **状态清理**: 渲染 Grid 后必须清理 VertexAttribArray，否则会破坏后续的模型渲染。

### `src/renderer/src/store/modelStore.ts`
- 管理模型数据状态。
- 注意 `extractNodesFromModel` 中的数据映射逻辑，War3 原始数据与 UI 需要的格式可能不同。

## 4. 给继任者的建议 (Advice for Next AI)

1.  **渲染循环很脆弱**: 
    *   目前的 `Viewer.tsx` 比较庞大且复杂。在修改渲染逻辑时，**务必小心**。
    *   如果出现黑屏，首先检查 `mdlRenderer.setCamera` 是否被调用，以及 WebGL 是否有报错 (使用 `console.error` 捕获)。

2.  **纹理加载是痛点**:
    *   War3 模型的纹理路径千奇百怪 (`Textures\`, `war3mapImported\`, 无前缀等)。
    *   目前的加载逻辑已经覆盖了大部分情况（MPQ 优先 -> 本地路径 -> 递归查找），如果遇到贴图丢失，请检查这里的逻辑。

3.  **坐标系**:
    *   War3 使用 Z 轴向上 (Z-Up)。
    *   `gl-matrix` 和 WebGL 通常是 Y 轴向上，但我们在相机计算时已经做了适配。在做 Gizmo 或新功能时，请时刻记住 **Z 是高度**。

4.  **备份习惯**:
    *   用户非常看重代码稳定性。在进行大规模重构（如拆分 `Viewer.tsx`）之前，**必须**先备份文件或创建备份文件夹。

5.  **沟通**:
    *   用户喜欢清晰的进度汇报。使用 Task 模式来管理任务，并在完成后提供 Walkthrough。

## 5. 调试技巧 (Debugging)
- **Console 是你的好朋友**: 渲染器中有很多 `console.log` 和 `console.warn`，利用它们定位纹理加载失败或 WebGL 错误。
- **强制线框模式**: 如果模型不显示，尝试强制开启线框模式 (`wireframe: true`)。如果线框能显示，说明几何数据没问题，问题出在纹理或着色器。

祝你好运！这是一个功能强大的编辑器，保持它的稳定至关重要。
