# 丝带渲染节点可视化编辑与同步技术交接文档 (Handoff)

## 1. 背景与核心需求 (Background & Core Objective)
在极坐标或线性动画编辑过程中，魔兽争霸3 (Warcraft 3) 的丝带流光 (Ribbon Emitters) 渲染必须与时间轴进度实现**绝对同步**。
用户目前遇到的核心痛点是：在时间轴拖拽（Scrubbing）或回退（Backward Scrubbing）时，丝带会发生视觉错乱（如巨大的拉伸三角形）、闪烁或直接消失。

## 2. 代码位置 (Key File Locations)
- **底层控制器逻辑**: `vendor/war3-model/renderer/ribbons.ts`
  - 负责丝带顶点的生成、缓冲区管理、以及核心的“历史重建”算法。
- **UI & 渲染循环钩子**: `src/renderer/src/components/Viewer.tsx`
  - 在 `currentMainMode === 'animation'` 的分支中处理时间轴拖拽逻辑。
- **底层模型实例**: `vendor/war3-model/renderer/modelInstance.ts`
  - 负责骨骼节点的矩阵更新 (`updateNode`)，丝带的顶点位置依赖于此。

## 3. 当前技术方案：无状态反向重构 (Stateless Reconstruction)
由于丝带是随时间累积的粒子系统，常规的 `update(delta)` 在时间轴跳转时会失效。当前的方案是：
1. **停止正向累加**: 在拖拽期间，不再依赖每帧累加。
2. **绝对历史重构 (`buildHistoryAt`)**: 
   - 核心函数：`RibbonsController.buildHistoryAt(targetFrame)`。
   - 逻辑：以 `targetFrame` 为终点，向后追溯一个 `LifeSpan`（寿命）长度的时间段。在此时间段内，算法会以 `16.67ms` 为步长进行**瞬时并行仿真**。
   - 目的：在用户停下的那一帧，瞬间计算出“如果从头播到这一帧，丝带应该长什么样”。

## 4. 当前已知缺陷 (Known Bugs)
1. **暂停消失 (Disappearance on Pause)**:
   - 现象：当时间轴停止拖拽进入暂停态时，丝带可能突然消失。
   - 根源：疑似 `RibbonsController.update(0)` 中的 `lastTimelineFrame` 逻辑与 `buildHistoryAt` 之后的首帧状态冲突，导致重绕判定 (Rewind Detection) 误触发了 `resetEmitters()`。
2. **重构错乱 (Reconstruction Artifacts)**:
   - 现象：某些模型在回退时，丝带会拉出巨大的、跨越屏幕的三角形。
   - 根源：在 `buildHistoryAt` 内部，`updateNodeAt` 对父骨骼的矩阵计算可能未完全同步（特别是带有全局序列 GlobalSequences 的模型），导致插值出的历史坐标点发生了空间跳跃。
3. **计算冗余**:
   - `Viewer.tsx` 里的 `while(remaining > 0)` 模拟逻辑与 `buildHistoryAt` 可能存在冗余执行，需要优化触发顺序。

## 5. 给接手 AI 的建议 (Advice for the next AI)
- **强制同步更新**: 确保在 `buildHistoryAt` 循环中，**所有** 父节点的矩阵都得到了强制更新，而不仅仅是当前节点。W3X 的骨骼是树状依赖的。
- **重写重绕逻辑**: `RibbonsController` 里的 `currentFrame < this.lastTimelineFrame - 0.001` 判定在手动重建模式下非常不稳定，建议增加一个 `isScrubbing` 标志位彻底挂起此判定。
- **顶点数据一致性**: 检查 `appendSample` 向 `TypedArray` 写入的顺序。如果采样是反向进行的，索引对齐错误会导致三角形索引乱序（扇面化）。

---
**状态**: 逻辑框架已打通 (Stateless Frame Injection)，但数值稳定性和骨骼同步仍需精调。
**当前版本分支**: `ultrathink-ribbons` (如果已提交)
