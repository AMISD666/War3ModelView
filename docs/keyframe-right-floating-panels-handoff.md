# 关键帧模式右侧浮层接手文档

## 1. 目标范围
- 本文只覆盖动画模式下，`关键帧模式`通过时间轴模式切换后出现的`右侧独立浮层`。
- 当前涉及 3 个模式：
1. `geosetAnim`（多边形组关键帧）
2. `particle`（粒子关键帧）
3. `textureAnim`（贴图动画）

## 2. 触发链路（时间轴 -> 模式状态 -> 浮层显示）

### 2.1 模式状态定义（全局 Store）
- 文件：`src/renderer/src/store/selectionStore.ts:15`
- `KeyframeDisplayMode = 'node' | 'geosetAnim' | 'particle' | 'textureAnim'`
- 相关字段：
1. `timelineKeyframeDisplayMode`：`src/renderer/src/store/selectionStore.ts:26`
2. `setTimelineKeyframeDisplayMode`：`src/renderer/src/store/selectionStore.ts:34`
3. `selectedTextureAnimIndex`：`src/renderer/src/store/selectionStore.ts:29`

### 2.2 时间轴顶部模式切换入口
- 文件：`src/renderer/src/components/animation/Timeline/TimelinePanel.tsx`
- 模式顺序：`KEYFRAME_DISPLAY_MODE_ORDER`：`TimelinePanel.tsx:134`
- 模式配置（标签、提示、轨道类型）：`KEYFRAME_DISPLAY_MODE_CONFIG`：`TimelinePanel.tsx:136`
- 当前模式读取：`keyframeDisplayMode = timelineKeyframeDisplayMode`：`TimelinePanel.tsx:427`
- 下拉菜单点击写回 Store：`setTimelineKeyframeDisplayMode(...)`：`TimelinePanel.tsx:2900`

### 2.3 布局层根据模式决定显示哪些右侧浮层
- 文件：`src/renderer/src/components/animation/AnimationModeLayout.tsx`
- 显示条件：
1. `showTextureAnimGizmo`：`AnimationModeLayout.tsx:53`
2. `showParticleAnimPanel`：`AnimationModeLayout.tsx:54`
- 渲染挂载位置：
1. 贴图浮层挂载：`AnimationModeLayout.tsx:127`
2. 粒子浮层挂载：`AnimationModeLayout.tsx:140`
- 两者定位均为 `right: 10`、`bottom: BOTTOM_PANEL_HEIGHT + 10`：`AnimationModeLayout.tsx:132`, `AnimationModeLayout.tsx:145`

## 3. 三个右侧浮层的 UI 布局与风格

## 3.1 统一视觉风格（已基本统一）
- 宽度：`320`
- 背景：`rgba(24,24,24,0.95)`
- 边框：`1px solid #3a3a3a`
- 圆角：`6`
- 文字主色：`#ddd`
- 顶部标题行：左侧标题 + 右侧状态/操作按钮
- 折叠按钮：`EyeOutlined / EyeInvisibleOutlined`

### 代码位置
1. 粒子面板壳：`src/renderer/src/components/animation/ParticleAnimKeyframePanel.tsx:244`
2. 贴图面板壳：`src/renderer/src/components/animation/TextureAnimGizmoPanel.tsx:875`
3. 多边形组面板壳：`src/renderer/src/components/animation/BoneParameterPanel.tsx:1293`

## 3.2 多边形组关键帧（geosetAnim）
- 入口条件：`animationSubMode === 'keyframe' && timelineKeyframeDisplayMode === 'geosetAnim'`
- 条件计算：`src/renderer/src/components/animation/BoneParameterPanel.tsx:1092`
- 底部偏移：`geosetPanelBottom`：`BoneParameterPanel.tsx:1093`
- 渲染块：`BoneParameterPanel.tsx:1291`
- 标题：`多边形组关键帧`：`BoneParameterPanel.tsx:1310`
- 关键内容：
1. 多选 Geoset 下拉
2. 透明度输入 + `K透明度` + `删帧`
3. 颜色选择 + 文本输入 + `K颜色` + `删帧`
4. 轨道编辑按钮（打开 `KeyframeEditor`）

## 3.3 粒子关键帧（particle）
- 挂载在布局层：`AnimationModeLayout.tsx:140`
- 组件：`src/renderer/src/components/animation/ParticleAnimKeyframePanel.tsx`
- 标题：`粒子关键帧`：`ParticleAnimKeyframePanel.tsx:256`
- 折叠状态：`collapsed`：`ParticleAnimKeyframePanel.tsx:117`
- 关键内容：
1. 8 条标量轨道输入（可见度、发射速率、速度、变化、纬度、长、宽、重力）
2. 单轨插帧与全量插帧按钮
3. 显示当前选中粒子数

## 3.4 贴图动画（textureAnim）
- 挂载在布局层：`AnimationModeLayout.tsx:127`
- 组件：`src/renderer/src/components/animation/TextureAnimGizmoPanel.tsx`
- 标题：`贴图动画`：`TextureAnimGizmoPanel.tsx:887`
- 折叠状态：`panelCollapsed`：`TextureAnimGizmoPanel.tsx:193`
- 关键内容：
1. 贴图动画选择器（`selectedTextureAnimIndex`）
2. 新建贴图动画按钮
3. 变换模式按钮（位移/旋转/缩放）
4. Gizmo 画布交互区 + 输入区 + 轨道属性编辑 + `KeyframeEditor`

## 4. 与时间轴轨道显示的对应关系
- 文件：`src/renderer/src/components/animation/Timeline/TimelinePanel.tsx`
- 模式 -> 轨道类型映射：
1. `node` -> `Translation/Rotation/Scaling`
2. `geosetAnim` -> `GeosetAlpha/GeosetColor`
3. `particle` -> 多个粒子参数轨道（时间轴中按统一轨道视觉处理）
4. `textureAnim` -> `TexTranslation/TexRotation/TexScaling`
- 映射定义：`KEYFRAME_DISPLAY_MODE_CONFIG`：`TimelinePanel.tsx:136`

## 5. 实现差异（接手优化时重点）

### 5.1 挂载层不一致
- 粒子/贴图：在 `AnimationModeLayout` 统一挂载（`absolute`）。
- 多边形组：在 `BoneParameterPanel` 内部渲染（`fixed`）。
- 影响：后续做统一层级、统一动画、统一响应式时，需要先统一挂载策略。

### 5.2 底部偏移计算来源不一致
- 粒子/贴图使用 `BOTTOM_PANEL_HEIGHT + 10`（来自 `AnimationModeLayout`）。
- 多边形组在自身组件内独立计算 `viewportHeight * 0.2` 再 clamp（`BoneParameterPanel.tsx:1093`）。
- 影响：窗口缩放、布局调整时，三个浮层可能出现 1~2px 到数 px 的不一致。

### 5.3 可抽象公共组件
- 可提取 `RightFloatingPanelShell`：
1. 统一壳样式（宽度、边框、背景、圆角、padding、gap）
2. 统一标题栏（标题、右侧状态、折叠按钮）
3. 统一定位策略（right / bottom / zIndex）

## 6. 编码与文本注意事项
- `BoneParameterPanel.tsx` 当前已转为 `UTF-8 无 BOM`，用于规避中文乱码问题。
- `TimelinePanel.tsx` 仍存在部分乱码文本（例如拖拽偏移提示一段），不在本次浮层整理范围，后续可单独清理。

## 7. 建议给下一个 AI 的优先优化顺序
1. 先统一 3 个浮层的挂载层（建议全部走 `AnimationModeLayout`）。
2. 再抽公共 `PanelShell`，消除重复样式与折叠逻辑。
3. 最后统一底部偏移来源与响应式策略（单一 `BOTTOM_PANEL_HEIGHT` 来源）。
