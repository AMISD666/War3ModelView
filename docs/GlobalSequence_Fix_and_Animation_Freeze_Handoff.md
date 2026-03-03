# 全局序列编辑修复与动画卡死分析文档

本文档汇总了近期关于“全局序列（Global Sequence）”编辑功能的修复工作，以及目前遗留的“动画卡死”问题的分析，供后续开发参考。

## 1. 已完成：粒子系统崩溃修复 (Particle Renderer Crash Fix)

### 问题描述
在修改全局序列时长后立即切换模型标签页，程序会因 `TypeError: Cannot read properties of undefined (reading 'matrix')` 崩溃。

### 修复方案
1. **防御性检查**：在 `vendor/war3-model/renderer/particles.ts` 中针对所有通过 `ObjectId` 访问 `rendererData.nodes` 的地方添加了空值检查。即使在模型切换的瞬态过程中节点索引失效，也不会导致程序崩溃。
2. **完善 Store Action**：在 `src/renderer/src/store/modelStore.ts` 中补全了 `updateGlobalSequence` 和 `addGlobalSequence` 的实现。这确保了独立窗口编辑后的数据能正确同步到主模型数据中，并触发 `rendererReloadTrigger`。
3. **IPC 同步**：确保 `MainLayout.tsx` 正确监听 `IPC_GLOBAL_SEQUENCE_UPDATE` 并调用 Store 更新逻辑。

---

## 2. 待解决：更新时长后动画卡死 (Animation Freeze)

### 问题表现
在“Keyframe Editor”中通过独立窗口成功修改全局序列时长后，Viewer 中的模型动画偶尔会进入“冻结”状态，不再播放。

### 关键代码位置

#### A. 数据同步流
- **[modelStore.ts](file:///d:/Desktop/war3modelview/War3ModelView/src/renderer/src/store/modelStore.ts)**:
  - `updateGlobalSequence`: 负责更新数据并递增 `rendererReloadTrigger`。
- **[Viewer.tsx](file:///d:/Desktop/war3modelview/War3ModelView/src/renderer/src/components/Viewer.tsx)**:
  - Line ~2691: `useEffect` 监听 `rendererReloadTrigger` 执行轻量级同步。
  - Line ~2929: 将 `GlobalSequences` 同步到底层的 `renderer.model` 并调用 `syncGlobalSequences()`。

#### B. 渲染引擎逻辑 (Vendor Library)
- **[modelInstance.ts](file:///d:/Desktop/war3modelview/War3ModelView/vendor/war3-model/renderer/modelInstance.ts)**:
  - `syncGlobalSequences()`: 负责调整 `globalSequencesFrames` 数组长度。
  - `updateGlobalSequences(delta)`: 负责根据 `GlobalSequences` 时长对 `globalSequencesFrames` 进行累加和取模（回滚）。这是动画循环的核心逻辑。
  - `update()`: 每一帧的更新入口。

### 疑似原因分析
1. **帧索引越界**：如果时长被改短，当前的 `globalSequencesFrames[i]` 可能已经超过了新的时长上限，导致取模逻辑或插值逻辑出现异常（虽然代码中有重置为 0 的逻辑，但需确认是否执行）。
2. **插值参数失效**：动画控制器（Animation Controllers）可能缓存了旧的时长参数，虽然数组引用更新了，但内部状态未刷新，导致计算结果为 `NaN` 或静态值。
3. **渲染循环中断**：需要检查控制台是否有新的隐藏报错，例如在 `interp.ts` 或 `modelInterp.ts` 中。

---

## 3. 后续修复建议
- 在 `modelInstance.ts` 的 `updateGlobalSequences` 中添加 Log，观察 `delta` 和时长值是否正常。
- 确认 `Viewer.tsx` 的轻量级同步是否完整。如果修改了全局序列时长，可能需要比 `syncGlobalSequences()` 更深层的刷新动作。
- 检查 `rendererReloadTrigger` 是否成功触发。
