# War3 Model Editor 开发任务清单 & 实现指南

> **给接手 AI 的说明**:
> 本文档包含了详细的开发任务分解，以及每个核心功能的**实现思路**。请在开发前仔细阅读对应章节的实现指南。
> 
> **当前项目状态**:
> - 核心功能稳定，UI/UX 现代化改造基本完成。
> - 骨骼绑定 UI 已实现。
> - 修复了多个关键崩溃 (React Hook, Infinite Loop)。

### 🎨 UI & 渲染优化 (Phase 1 - 2025-12-01)
- [x] **编辑器 UI 优化**
  - [x] 修复编辑器面板宽度显示异常 (只显示右侧一小部分)
  - [x] 重构编辑器 UI 风格 (纹理/序列/材质/多边形) 为现代风格
- [x] **顶点模式优化**
  - [x] 放大顶点显示 (2x)
  - [x] 保持线框模式 (确认用户意图)
- [x] **骨骼显示与交互**
  - [x] 实现骨骼自定义颜色 (默认绿/选中红/父黑/子黄)
  - [x] 支持骨骼单选
  - [x] 支持 Alt+Left Click 框选骨骼
- [x] **动画模式交互**
  - [x] 修复切换模式时的按钮闪烁 (通过稳定布局和修复渲染状态解决)
  - [x] 关键帧模式下允许播放动画

### 🎨 UI & 渲染优化 (Phase 2 - 2025-12-01 Feedback)
- [x] **编辑器 UI 布局修复**
  - [x] 修复编辑器面板位置/宽度问题 (目前只显示一条边，需自适应右侧布局)
- [x] **顶点模式渲染优化**
  - [x] 移除进入顶点模式强制线框的逻辑 (允许显示纹理)
  - [x] 实现线框模式与纹理模式的叠加 (Additive) 而非互斥
  - [x] 修复从顶点模式切换到动画模式时的残留顶点显示
- [x] **模型导入与重置**
  - [x] 实现导入新模型时的全局重置 (回到查看模式, 重置相机, 清空选择)
  - [x] 修复在动画模式下导入新模型导致的播放故障和报错

### 🎨 UI & 渲染优化 (Phase 3 - 2025-12-01 Bug Fixes)
- [x] **Import Crash (Texture Error)**: Fixed `Cannot read properties of undefined (reading 'Image')` by ensuring `renderer.update(0)` is called.
- [x] **Animation Playback**: Fixed animation not playing in View Mode by reverting strict Bind Pose logic.
- [ ] **Vertex Mode & Viewer**
  - [ ] **Vertex Editor Persistence**: Fix issue where Vertex Editor window remains visible after switching modes.
  - [ ] **Localization**: Translate all Vertex Mode tooltips and instructions to Chinese.
  - [x] **GeosetEditor**: Optimize or hide vertex/face count display to reduce clutter.

### 🐛 Bug Fixes & Enhancements (Phase 5 - 2025-12-01 User Report)
- [ ] **Import Auto-Play**
  - [ ] **Fix Auto-Play**: Ensure model plays first animation immediately after import (currently paused/no anim).
- [x] **Bone Rendering (Bind Pose)**
  - [x] **Visibility**: Ensure bones are visible in Bind Pose (Animation Mode).
  - [x] **Color Coding**: Implement specific colors: Default(Green), Selected(Red), Parent(Black), Children(Yellow).
- [x] **Scale Consistency**
  - [x] **Fix Scale Mismatch**: Resolve size difference between Bind Pose and Keyframe Mode (Keyframe mode appears larger).

### 🚨 Critical Fixes & Localization (Phase 6 - 2025-12-01 Regression)
- [x] **Layout & UI**
  - [x] **Layout Conflict**: Fix overlap/truncation between Node Manager (Left) and Editor Panel (Right). Ensure they coexist properly.
  - [x] **Localization**: Translate ALL remaining English text and buttons to Chinese.
- [x] **Rendering & Animation**
  - [x] **Bind Pose Fix**: Ensure "Bind Pose" (Geometry/Binding Mode) strictly stops animation and resets to Frame 0.
  - [x] **Vertex Alignment**: Fix mismatch between vertex points (blue dots) and model mesh (ensure both are in Bind Pose).
  - [x] **Bone Visibility**: Fix bones not rendering in Animation Mode.

### 🔧 Gizmo & Interaction Fixes (Phase 8 - 2025-12-01)
- [x] **Fix Viewer.tsx Structure**: Resolved premature closure of `Viewer` component and `handleMouseMove` scope issues.
- [x] **Gizmo Interaction Logic**: Prevent vertex manipulation in Animation Mode (Binding Submode).
- [x] **Gizmo Rendering**: Show Gizmo for selected bones in Binding Mode; Hide Gizmo for vertices in Binding Mode.
- [x] **Fix Vertex Stuck Bug**: Resolved by correcting interaction logic.

### 🦴 Bone Binding UI & Sync (Phase 9 - 2025-12-01)
- [x] **Bone Binding Panel**
    - [x] Create `BoneBindingPanel.tsx` to list bones bound to selected vertices.
    - [x] Show panel only in Animation Mode -> Binding Submode.
    - [x] Highlight bones in the list if selected.
- [x] **Bidirectional Sync**
    - [x] Double-click bone in panel -> Open Node Manager & Select Bone.
    - [x] Select bone in Node Manager/Viewer -> Highlight in Panel.
    - [x] Auto-expand Node Manager tree to selected node.
# War3 Model Editor 开发任务清单 & 实现指南

> **给接手 AI 的说明**:
> 本文档包含了详细的开发任务分解，以及每个核心功能的**实现思路**。请在开发前仔细阅读对应章节的实现指南。
> 
> **当前项目状态**:
> - 核心功能稳定，UI/UX 现代化改造基本完成。
> - 骨骼绑定 UI 已实现。
> - 修复了多个关键崩溃 (React Hook, Infinite Loop)。

### 🎨 UI & 渲染优化 (Phase 1 - 2025-12-01)
- [x] **编辑器 UI 优化**
  - [x] 修复编辑器面板宽度显示异常 (只显示右侧一小部分)
  - [x] 重构编辑器 UI 风格 (纹理/序列/材质/多边形) 为现代风格
- [x] **顶点模式优化**
  - [x] 放大顶点显示 (2x)
  - [x] 保持线框模式 (确认用户意图)
- [x] **骨骼显示与交互**
  - [x] 实现骨骼自定义颜色 (默认绿/选中红/父黑/子黄)
  - [x] 支持骨骼单选
  - [x] 支持 Alt+Left Click 框选骨骼
- [x] **动画模式交互**
  - [x] 修复切换模式时的按钮闪烁 (通过稳定布局和修复渲染状态解决)
  - [x] 关键帧模式下允许播放动画

### 🎨 UI & 渲染优化 (Phase 2 - 2025-12-01 Feedback)
- [x] **编辑器 UI 布局修复**
  - [x] 修复编辑器面板位置/宽度问题 (目前只显示一条边，需自适应右侧布局)
- [x] **顶点模式渲染优化**
  - [x] 移除进入顶点模式强制线框的逻辑 (允许显示纹理)
  - [x] 实现线框模式与纹理模式的叠加 (Additive) 而非互斥
  - [x] 修复从顶点模式切换到动画模式时的残留顶点显示
- [x] **模型导入与重置**
  - [x] 实现导入新模型时的全局重置 (回到查看模式, 重置相机, 清空选择)
  - [x] 修复在动画模式下导入新模型导致的播放故障和报错

### 🎨 UI & 渲染优化 (Phase 3 - 2025-12-01 Bug Fixes)
- [x] **Import Crash (Texture Error)**: Fixed `Cannot read properties of undefined (reading 'Image')` by ensuring `renderer.update(0)` is called.
- [x] **Animation Playback**: Fixed animation not playing in View Mode by reverting strict Bind Pose logic.
- [ ] **Vertex Mode & Viewer**
  - [ ] **Vertex Editor Persistence**: Fix issue where Vertex Editor window remains visible after switching modes.
  - [ ] **Localization**: Translate all Vertex Mode tooltips and instructions to Chinese.
  - [x] **GeosetEditor**: Optimize or hide vertex/face count display to reduce clutter.

### 🐛 Bug Fixes & Enhancements (Phase 5 - 2025-12-01 User Report)
- [ ] **Import Auto-Play**
  - [ ] **Fix Auto-Play**: Ensure model plays first animation immediately after import (currently paused/no anim).
- [x] **Bone Rendering (Bind Pose)**
  - [x] **Visibility**: Ensure bones are visible in Bind Pose (Animation Mode).
  - [x] **Color Coding**: Implement specific colors: Default(Green), Selected(Red), Parent(Black), Children(Yellow).
- [x] **Scale Consistency**
  - [x] **Fix Scale Mismatch**: Resolve size difference between Bind Pose and Keyframe Mode (Keyframe mode appears larger).

### 🚨 Critical Fixes & Localization (Phase 6 - 2025-12-01 Regression)
- [x] **Layout & UI**
  - [x] **Layout Conflict**: Fix overlap/truncation between Node Manager (Left) and Editor Panel (Right). Ensure they coexist properly.
  - [x] **Localization**: Translate ALL remaining English text and buttons to Chinese.
- [x] **Rendering & Animation**
  - [x] **Bind Pose Fix**: Ensure "Bind Pose" (Geometry/Binding Mode) strictly stops animation and resets to Frame 0.
  - [x] **Vertex Alignment**: Fix mismatch between vertex points (blue dots) and model mesh (ensure both are in Bind Pose).
  - [x] **Bone Visibility**: Fix bones not rendering in Animation Mode.

### 🔧 Gizmo & Interaction Fixes (Phase 8 - 2025-12-01)
- [x] **Fix Viewer.tsx Structure**: Resolved premature closure of `Viewer` component and `handleMouseMove` scope issues.
- [x] **Gizmo Interaction Logic**: Prevent vertex manipulation in Animation Mode (Binding Submode).
- [x] **Gizmo Rendering**: Show Gizmo for selected bones in Binding Mode; Hide Gizmo for vertices in Binding Mode.
- [x] **Fix Vertex Stuck Bug**: Resolved by correcting interaction logic.

### 🦴 Bone Binding UI & Sync (Phase 9 - 2025-12-01)
- [x] **Bone Binding Panel**
    - [x] Create `BoneBindingPanel.tsx` to list bones bound to selected vertices.
    - [x] Show panel only in Animation Mode -> Binding Submode.
    - [x] Highlight bones in the list if selected.
- [x] **Bidirectional Sync**
    - [x] Double-click bone in panel -> Open Node Manager & Select Bone.
    - [x] Select bone in Node Manager/Viewer -> Highlight in Panel.
    - [x] Auto-expand Node Manager tree to selected node.
- [x] **Crash Fixes**
# War3 Model Editor 开发任务清单 & 实现指南

> **给接手 AI 的说明**:
> 本文档包含了详细的开发任务分解，以及每个核心功能的**实现思路**。请在开发前仔细阅读对应章节的实现指南。
> 
> **当前项目状态**:
> - 核心功能稳定，UI/UX 现代化改造基本完成。
> - 骨骼绑定 UI 已实现。
> - 修复了多个关键崩溃 (React Hook, Infinite Loop)。

### 🎨 UI & 渲染优化 (Phase 1 - 2025-12-01)
- [x] **编辑器 UI 优化**
  - [x] 修复编辑器面板宽度显示异常 (只显示右侧一小部分)
  - [x] 重构编辑器 UI 风格 (纹理/序列/材质/多边形) 为现代风格
- [x] **顶点模式优化**
  - [x] 放大顶点显示 (2x)
  - [x] 保持线框模式 (确认用户意图)
- [x] **骨骼显示与交互**
  - [x] 实现骨骼自定义颜色 (默认绿/选中红/父黑/子黄)
  - [x] 支持骨骼单选
  - [x] 支持 Alt+Left Click 框选骨骼
- [x] **动画模式交互**
  - [x] 修复切换模式时的按钮闪烁 (通过稳定布局和修复渲染状态解决)
  - [x] 关键帧模式下允许播放动画

### 🎨 UI & 渲染优化 (Phase 2 - 2025-12-01 Feedback)
- [x] **编辑器 UI 布局修复**
  - [x] 修复编辑器面板位置/宽度问题 (目前只显示一条边，需自适应右侧布局)
- [x] **顶点模式渲染优化**
  - [x] 移除进入顶点模式强制线框的逻辑 (允许显示纹理)
  - [x] 实现线框模式与纹理模式的叠加 (Additive) 而非互斥
  - [x] 修复从顶点模式切换到动画模式时的残留顶点显示
- [x] **模型导入与重置**
  - [x] 实现导入新模型时的全局重置 (回到查看模式, 重置相机, 清空选择)
  - [x] 修复在动画模式下导入新模型导致的播放故障和报错

### 🎨 UI & 渲染优化 (Phase 3 - 2025-12-01 Bug Fixes)
- [x] **Import Crash (Texture Error)**: Fixed `Cannot read properties of undefined (reading 'Image')` by ensuring `renderer.update(0)` is called.
- [x] **Animation Playback**: Fixed animation not playing in View Mode by reverting strict Bind Pose logic.
- [ ] **Vertex Mode & Viewer**
  - [ ] **Vertex Editor Persistence**: Fix issue where Vertex Editor window remains visible after switching modes.
  - [ ] **Localization**: Translate all Vertex Mode tooltips and instructions to Chinese.
  - [x] **GeosetEditor**: Optimize or hide vertex/face count display to reduce clutter.

### 🐛 Bug Fixes & Enhancements (Phase 5 - 2025-12-01 User Report)
- [ ] **Import Auto-Play**
  - [ ] **Fix Auto-Play**: Ensure model plays first animation immediately after import (currently paused/no anim).
- [x] **Bone Rendering (Bind Pose)**
  - [x] **Visibility**: Ensure bones are visible in Bind Pose (Animation Mode).
  - [x] **Color Coding**: Implement specific colors: Default(Green), Selected(Red), Parent(Black), Children(Yellow).
- [x] **Scale Consistency**
  - [x] **Fix Scale Mismatch**: Resolve size difference between Bind Pose and Keyframe Mode (Keyframe mode appears larger).

### 🚨 Critical Fixes & Localization (Phase 6 - 2025-12-01 Regression)
- [x] **Layout & UI**
  - [x] **Layout Conflict**: Fix overlap/truncation between Node Manager (Left) and Editor Panel (Right). Ensure they coexist properly.
  - [x] **Localization**: Translate ALL remaining English text and buttons to Chinese.
- [x] **Rendering & Animation**
  - [x] **Bind Pose Fix**: Ensure "Bind Pose" (Geometry/Binding Mode) strictly stops animation and resets to Frame 0.
  - [x] **Vertex Alignment**: Fix mismatch between vertex points (blue dots) and model mesh (ensure both are in Bind Pose).
  - [x] **Bone Visibility**: Fix bones not rendering in Animation Mode.

### 🔧 Gizmo & Interaction Fixes (Phase 8 - 2025-12-01)
- [x] **Fix Viewer.tsx Structure**: Resolved premature closure of `Viewer` component and `handleMouseMove` scope issues.
- [x] **Gizmo Interaction Logic**: Prevent vertex manipulation in Animation Mode (Binding Submode).
- [x] **Gizmo Rendering**: Show Gizmo for selected bones in Binding Mode; Hide Gizmo for vertices in Binding Mode.
- [x] **Fix Vertex Stuck Bug**: Resolved by correcting interaction logic.

### 🦴 Bone Binding UI & Sync (Phase 9 - 2025-12-01)
- [x] **Bone Binding Panel**
    - [x] Create `BoneBindingPanel.tsx` to list bones bound to selected vertices.
    - [x] Show panel only in Animation Mode -> Binding Submode.
    - [x] Highlight bones in the list if selected.
- [x] **Bidirectional Sync**
    - [x] Double-click bone in panel -> Open Node Manager & Select Bone.
    - [x] Select bone in Node Manager/Viewer -> Highlight in Panel.
    - [x] Auto-expand Node Manager tree to selected node.
- [x] **Import Crash (Texture Error)**: Fixed `Cannot read properties of undefined (reading 'Image')` by ensuring `renderer.update(0)` is called.
- [x] **Animation Playback**: Fixed animation not playing in View Mode by reverting strict Bind Pose logic.
- [ ] **Vertex Mode & Viewer**
  - [ ] **Vertex Editor Persistence**: Fix issue where Vertex Editor window remains visible after switching modes.
  - [ ] **Localization**: Translate all Vertex Mode tooltips and instructions to Chinese.
  - [x] **GeosetEditor**: Optimize or hide vertex/face count display to reduce clutter.

### 🐛 Bug Fixes & Enhancements (Phase 5 - 2025-12-01 User Report)
- [ ] **Import Auto-Play**
  - [ ] **Fix Auto-Play**: Ensure model plays first animation immediately after import (currently paused/no anim).
- [x] **Bone Rendering (Bind Pose)**
  - [x] **Visibility**: Ensure bones are visible in Bind Pose (Animation Mode).
  - [x] **Color Coding**: Implement specific colors: Default(Green), Selected(Red), Parent(Black), Children(Yellow).
- [x] **Scale Consistency**
  - [x] **Fix Scale Mismatch**: Resolve size difference between Bind Pose and Keyframe Mode (Keyframe mode appears larger).

### 🚨 Critical Fixes & Localization (Phase 6 - 2025-12-01 Regression)
- [x] **Layout & UI**
  - [x] **Layout Conflict**: Fix overlap/truncation between Node Manager (Left) and Editor Panel (Right). Ensure they coexist properly.
  - [x] **Localization**: Translate ALL remaining English text and buttons to Chinese.
- [x] **Rendering & Animation**
  - [x] **Bind Pose Fix**: Ensure "Bind Pose" (Geometry/Binding Mode) strictly stops animation and resets to Frame 0.
  - [x] **Vertex Alignment**: Fix mismatch between vertex points (blue dots) and model mesh (ensure both are in Bind Pose).
  - [x] **Bone Visibility**: Fix bones not rendering in Animation Mode.

### 🔧 Gizmo & Interaction Fixes (Phase 8 - 2025-12-01)
- [x] **Fix Viewer.tsx Structure**: Resolved premature closure of `Viewer` component and `handleMouseMove` scope issues.
- [x] **Gizmo Interaction Logic**: Prevent vertex manipulation in Animation Mode (Binding Submode).
- [x] **Gizmo Rendering**: Show Gizmo for selected bones in Binding Mode; Hide Gizmo for vertices in Binding Mode.
- [x] **Fix Vertex Stuck Bug**: Resolved by correcting interaction logic.

### 🦴 Bone Binding UI & Sync (Phase 9 - 2025-12-01)
- [x] **Bone Binding Panel**
    - [x] Create `BoneBindingPanel.tsx` to list bones bound to selected vertices.
    - [x] Show panel only in Animation Mode -> Binding Submode.
    - [x] Highlight bones in the list if selected.
- [x] **Bidirectional Sync**
    - [x] Double-click bone in panel -> Open Node Manager & Select Bone.
    - [x] Select bone in Node Manager/Viewer -> Highlight in Panel.
    - [x] Auto-expand Node Manager tree to selected node.
- [x] **Crash Fixes**
# War3 Model Editor 开发任务清单 & 实现指南

> **给接手 AI 的说明**:
> 本文档包含了详细的开发任务分解，以及每个核心功能的**实现思路**。请在开发前仔细阅读对应章节的实现指南。
> 
> **当前项目状态**:
> - 核心功能稳定，UI/UX 现代化改造基本完成。
> - 骨骼绑定 UI 已实现。
> - 修复了多个关键崩溃 (React Hook, Infinite Loop)。

### 🎨 UI & 渲染优化 (Phase 1 - 2025-12-01)
- [x] **编辑器 UI 优化**
  - [x] 修复编辑器面板宽度显示异常 (只显示右侧一小部分)
  - [x] 重构编辑器 UI 风格 (纹理/序列/材质/多边形) 为现代风格
- [x] **顶点模式优化**
  - [x] 放大顶点显示 (2x)
  - [x] 保持线框模式 (确认用户意图)
- [x] **骨骼显示与交互**
  - [x] 实现骨骼自定义颜色 (默认绿/选中红/父黑/子黄)
  - [x] 支持骨骼单选
  - [x] 支持 Alt+Left Click 框选骨骼
- [x] **动画模式交互**
  - [x] 修复切换模式时的按钮闪烁 (通过稳定布局和修复渲染状态解决)
  - [x] 关键帧模式下允许播放动画

### 🎨 UI & 渲染优化 (Phase 2 - 2025-12-01 Feedback)
- [x] **编辑器 UI 布局修复**
  - [x] 修复编辑器面板位置/宽度问题 (目前只显示一条边，需自适应右侧布局)
- [x] **顶点模式渲染优化**
  - [x] 移除进入顶点模式强制线框的逻辑 (允许显示纹理)
  - [x] 实现线框模式与纹理模式的叠加 (Additive) 而非互斥
  - [x] 修复从顶点模式切换到动画模式时的残留顶点显示
- [x] **模型导入与重置**
  - [x] 实现导入新模型时的全局重置 (回到查看模式, 重置相机, 清空选择)
  - [x] 修复在动画模式下导入新模型导致的播放故障和报错

### 🎨 UI & 渲染优化 (Phase 3 - 2025-12-01 Bug Fixes)
- [x] **Import Crash (Texture Error)**: Fixed `Cannot read properties of undefined (reading 'Image')` by ensuring `renderer.update(0)` is called.
- [x] **Animation Playback**: Fixed animation not playing in View Mode by reverting strict Bind Pose logic.
- [ ] **Vertex Mode & Viewer**
  - [ ] **Vertex Editor Persistence**: Fix issue where Vertex Editor window remains visible after switching modes.
  - [ ] **Localization**: Translate all Vertex Mode tooltips and instructions to Chinese.
  - [x] **GeosetEditor**: Optimize or hide vertex/face count display to reduce clutter.

### 🐛 Bug Fixes & Enhancements (Phase 5 - 2025-12-01 User Report)
- [ ] **Import Auto-Play**
  - [ ] **Fix Auto-Play**: Ensure model plays first animation immediately after import (currently paused/no anim).
- [x] **Bone Rendering (Bind Pose)**
  - [x] **Visibility**: Ensure bones are visible in Bind Pose (Animation Mode).
  - [x] **Color Coding**: Implement specific colors: Default(Green), Selected(Red), Parent(Black), Children(Yellow).
- [x] **Scale Consistency**
  - [x] **Fix Scale Mismatch**: Resolve size difference between Bind Pose and Keyframe Mode (Keyframe mode appears larger).

### 🚨 Critical Fixes & Localization (Phase 6 - 2025-12-01 Regression)
- [x] **Layout & UI**
  - [x] **Layout Conflict**: Fix overlap/truncation between Node Manager (Left) and Editor Panel (Right). Ensure they coexist properly.
  - [x] **Localization**: Translate ALL remaining English text and buttons to Chinese.
- [x] **Rendering & Animation**
  - [x] **Bind Pose Fix**: Ensure "Bind Pose" (Geometry/Binding Mode) strictly stops animation and resets to Frame 0.
  - [x] **Vertex Alignment**: Fix mismatch between vertex points (blue dots) and model mesh (ensure both are in Bind Pose).
  - [x] **Bone Visibility**: Fix bones not rendering in Animation Mode.

### 🔧 Gizmo & Interaction Fixes (Phase 8 - 2025-12-01)
- [x] **Fix Viewer.tsx Structure**: Resolved premature closure of `Viewer` component and `handleMouseMove` scope issues.
- [x] **Gizmo Interaction Logic**: Prevent vertex manipulation in Animation Mode (Binding Submode).
- [x] **Gizmo Rendering**: Show Gizmo for selected bones in Binding Mode; Hide Gizmo for vertices in Binding Mode.
- [x] **Fix Vertex Stuck Bug**: Resolved by correcting interaction logic.

### 🦴 Bone Binding UI & Sync (Phase 9 - 2025-12-01)
- [x] **Bone Binding Panel**
    - [x] Create `BoneBindingPanel.tsx` to list bones bound to selected vertices.
    - [x] Show panel only in Animation Mode -> Binding Submode.
    - [x] Highlight bones in the list if selected.
- [x] **Bidirectional Sync**
    - [x] Double-click bone in panel -> Open Node Manager & Select Bone.
    - [x] Select bone in Node Manager/Viewer -> Highlight in Panel.
    - [x] Auto-expand Node Manager tree to selected node.
- [x] **Crash Fixes**
    - [x] Fix React Hook order violation in `BoneBindingPanel`.
    - [x] Fix infinite loop in `NodeManagerWindow` auto-expand logic.
    - [x] Add safety checks for geoset data access.

### 🛠️ Node Manager & Material Editor (Phase 10 - 2025-12-02)
- [x] **Node Manager Fixes**
    - [x] **Fix NaN ID**: Ensure new nodes get valid ObjectIds.
    - [x] **Fix Context Menu**: Enable right-click menu for new nodes.
- [x] **Material Editor Redesign**
    - [x] **Level 1 (List)**: Display material list.
    - [x] **Level 2 (Material)**: Layer list with drag-and-drop, plus specific settings (Priority, Const Color, etc.).
    - [x] **Level 3 (Layer)**: Detailed layer properties (Transparency, Texture, Flags, Filter Mode).
    - [x] **No Translation**: Keep "Filter Mode" options in English.
- [ ] **Texture Editor Redesign**
    - [ ] **Modal UI**: Double-click texture to open detail modal.
    - [ ] **Split Layout**: Left (Image), Right (Settings).
    - [ ] **Settings**: Filename, Wrap Width/Height, Replaceable ID.

### 🔮 Future Goals (Next Steps)
- [x] **Vertex Editor Persistence**: Ensure the Vertex Editor window state is correctly managed when switching modes.
- [x] **Import Auto-Play**: Ensure the first animation plays automatically upon import.
- [ ] **Performance Optimization**: Large models with many nodes might slow down the `NodeManager` tree generation.
- [ ] **Advanced Editing**: Implement "Add/Remove Bone", "Weight Painting".