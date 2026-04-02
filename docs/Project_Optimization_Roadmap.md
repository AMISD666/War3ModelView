# War3ModelView 项目优化路线图

## 目标

本文档用于指导当前仓库的系统性优化，目标不是零散修补，而是在不打断现有功能迭代的前提下，逐步提升以下四个方面：

- 稳定性：减少乱码、局部报错拖垮全局、功能回归无人察觉的问题
- 架构清晰度：降低 UI、模型数据、预览状态互相耦合导致的连锁 bug
- 性能：改善 Viewer、独立窗口、批量模式、跨窗口同步的卡顿与资源浪费
- 可持续开发性：让后续新增功能时更容易定位问题、更少引入回归

本文档基于当前仓库结构编写，适用于：

- `src/renderer/src/components`
- `src/renderer/src/store`
- `src/renderer/src/services`
- `src/renderer/src/utils`
- `src/renderer/src/workers`
- `src-tauri`

## 当前问题概览

结合当前仓库状态，可以归纳出几类高频问题：

- UI 文案直接散落在组件内，且已出现过编码损坏与乱码
- `MainLayout.tsx`、`Viewer.tsx`、`MenuBar.tsx` 等核心组件过大，局部问题容易蔓延成整体故障
- Zustand store 被大量组件直接订阅，状态边界不清晰
- 编辑态、预览态、提交态混用，导致很多“改参数后异常写回”的问题
- 独立窗口和主窗口之间的实时同步缺少统一节流策略，容易把消息队列打满
- Viewer 中 gizmo、overlay、hit test、global transform 等逻辑高度集中，维护成本高
- 批量模式和缩略图链路已经具备明显的异步调度优化空间
- 缺少统一的故障隔离、回归检查、最小自动化测试体系

## 优化原则

后续所有优化任务，默认遵守以下原则：

1. 先收敛状态边界，再优化功能细节。
2. 先治理高频核心路径，再处理边缘组件。
3. 优先抽公共机制，不重复在单个面板里做特判。
4. 所有新增优化尽量配套最小验证手段。
5. 不在优化过程中破坏现有编辑器工作流。

## 优先级总览

### P0：稳定性治理

目标：先把“容易炸”的地方收紧。

### P1：状态架构治理

目标：把真实模型数据、局部编辑会话、实时预览链路分开。

### P2：性能治理

目标：解决 Viewer、独立窗口、批量预览的卡顿与无效计算。

### P3：工程化和长期演进

目标：让未来功能迭代的成本下降，而不是继续堆复杂度。

## P0：稳定性治理

### 1. 文案与编码治理

#### 问题

当前项目已有多个组件出现中文乱码、坏 JSX、编码混乱等问题。最典型的是菜单和主布局类文件。

#### 目标

- 所有源码文件统一为 UTF-8
- 用户可见文案尽量不散落在核心组件中
- 避免未来再次因为保存/复制/拼接错误导致整块 UI 损坏

#### 建议改造

- 新建统一文案文件，例如：
  - `src/renderer/src/constants/uiText.ts`
  - 或分模块文案文件，如 `menuText.ts`、`dialogText.ts`
- 把 `MenuBar.tsx`、`MainLayout.tsx`、主要 Modal 中直接写死的中文常量抽离
- 建立最小约束：
  - 所有新增中文文案优先写到常量文件
  - 超过 3 个复用点的文案必须抽离

#### 验收标准

- 核心菜单、工具栏、主要弹窗中不存在乱码
- 至少完成 `MenuBar`、`MainLayout`、主要高频弹窗的文案抽离

### 2. Error Boundary 故障隔离

#### 问题

当前局部组件报错经常会把整个界面拖死，例如独立窗口、主布局懒加载、粒子编辑器等路径。

#### 目标

把运行时错误控制在局部区域，而不是整应用白屏。

#### 建议改造

- 新增通用错误边界组件：
  - `src/renderer/src/components/common/AppErrorBoundary.tsx`
- 在以下区域挂载：
  - 主布局
  - Viewer 区域
  - 独立节点编辑窗口
  - 各大型 modal 容器
- 错误边界 UI 最少包含：
  - 简短错误提示
  - 重新打开或关闭当前面板按钮
  - 控制台输出错误堆栈

#### 验收标准

- 任意单个编辑器组件抛错，不再导致整个应用不可用
- 独立窗口内异常只影响当前窗口

### 3. 最小回归清单

#### 问题

当前项目功能面很多，局部改动很容易影响别处。

#### 目标

建立一个发布前固定执行的最小回归检查。

#### 建议内容

在 `docs` 中新增回归清单，例如 `docs/Regression_Checklist.md`，至少覆盖：

- 模型导入、保存、另存、MDL/MDX 互转
- 当前模型 TXT 文本视图
- 粒子节点编辑器实时预览
- 粒子整体滑块、过滤模式
- 独立节点窗口 reopen / close / undo
- 全局变换 gizmo
- 材质过滤模式下拉
- 批量模式卡片与缩略图

#### 验收标准

- 每次大改动前后都能快速走完固定检查
- 回归检查项不再完全依赖口头记忆

## P1：状态架构治理

### 1. 分离 Document State / Editor Session / Preview State

#### 问题

现在多个面板存在“表单值直接写回模型”“拖动中频繁推送主窗口”“关闭时再补历史”等混合逻辑。

#### 目标

明确三类状态：

- Document State：真实模型数据
- Editor Session State：当前弹窗或独立窗口的本地编辑值
- Preview State：仅供 Viewer 渲染的临时预览值

#### 建议改造

- 在编辑器类组件中统一采用以下模式：
  - 打开窗口时复制 document state 到 session state
  - 拖动中只更新 session state
  - 节流地推 preview state
  - 点击应用或关闭确认时写回 document state
- 优先治理：
  - `ParticleEmitter2Dialog.tsx`
  - `NodeDialog.tsx`
  - 材质/贴图编辑器

#### 验收标准

- 拖动与输入过程中，不直接污染真实模型
- 关闭窗口、撤销、重开窗口时行为稳定一致

### 2. 给 Zustand 增加 selector 层

#### 问题

当前组件层直接访问多个 store 的情况较多，订阅粒度偏粗，后续维护和性能优化都困难。

#### 目标

减少组件对底层 store 结构的直接依赖。

#### 建议改造

- 在 `store/selectors` 或 `hooks/selectors` 下增加选择器封装
- 例如：
  - `useCurrentModelExtents`
  - `useGlobalTransformAnchor`
  - `useSelectedNodeWorldPositions`
  - `useBatchVisibleCards`
- 对高频组件优先替换：
  - `Viewer.tsx`
  - `MainLayout.tsx`
  - `BatchManager.tsx`
  - 粒子和节点编辑器

#### 验收标准

- 高复杂组件订阅的 store 切片明显减少
- 组件不再大量依赖整个 store 对象结构

### 3. 统一 history / command 入口

#### 问题

当前不同编辑器的撤销链路并不完全一致，有的实时写回，有的关闭才记 history。

#### 目标

所有文档修改统一走命令体系或统一提交入口。

#### 建议改造

- 增加统一接口，例如：
  - `applyDocumentCommand`
  - `applyPreviewPatch`
  - `commitPreviewAsHistory`
- 为以下场景统一策略：
  - 粒子参数编辑
  - 节点参数编辑
  - 全局变换
  - 材质和贴图编辑

#### 验收标准

- 撤销/重做行为在主要编辑器里一致
- 不再出现“看得见改动但撤销不了”的路径

## P2：性能治理

### 1. 跨窗口实时同步节流

#### 问题

独立窗口编辑器与主窗口之间的 `postMessage` 链路已经出现过消息队列打满、FPS 跌到个位数的问题。

#### 目标

建立统一的跨窗口预览调度机制，避免每个编辑器自己实现一套。

#### 建议改造

- 新建预览桥服务，例如：
  - `src/renderer/src/services/editorPreviewBridge.ts`
- 统一策略：
  - `onChange` 仅更新本地 session state
  - 使用 `requestAnimationFrame` 或 `30~60ms` 节流发送 preview
  - `onAfterChange` / 松手 / blur 时再 commit 一次
- 优先接入：
  - 粒子编辑器
  - 节点编辑器
  - 材质和贴图强预览面板

#### 验收标准

- 长时间拖动滑块不再引发明显掉帧
- 不再出现消息队列配额耗尽错误

### 2. Viewer 模块拆分与缓存

#### 问题

`Viewer.tsx` 当前体量大、职责多、逻辑集中，性能和维护都受到影响。

#### 目标

拆出高频计算模块并引入缓存，减少重复计算。

#### 建议拆分方向

- `viewer/gizmoAnchor.ts`
- `viewer/gizmoHitTest.ts`
- `viewer/globalTransform.ts`
- `viewer/selectionCenter.ts`
- `viewer/overlayRender.ts`

#### 建议缓存点

- 模型未变化时缓存 extents
- 节点世界包围盒缓存
- 选中集未变化时缓存 gizmo 中心点
- 鼠标未移动时不重复做 hover hit test

#### 验收标准

- `Viewer.tsx` 主文件体积和职责明显下降
- gizmo 与 overlay 相关计算链更清晰

### 3. 批量模式缩略图任务队列

#### 问题

批量模式涉及卡片、动画预览、缩略图生成，当前仍有进一步的队列调度空间。

#### 目标

把缩略图生成从“谁先触发谁跑”改成“可见优先、可取消、有限并发”的明确任务模型。

#### 建议改造

- 建立缩略图任务队列服务
- 策略建议：
  - 仅优先生成视口内可见卡片
  - 同一模型内容 hash 直接复用缓存
  - 滚动离开视口时取消未完成任务
  - Worker 池限制并发数

#### 验收标准

- 批量模式滚动和切换时更平稳
- CPU 与内存峰值降低

### 4. 高订阅组件重渲染治理

#### 问题

项目中组件层 store 订阅数量已经较多，部分重渲染可能是无效的。

#### 目标

优先减少高频组件的无意义刷新。

#### 建议排查对象

- `Viewer.tsx`
- `MainLayout.tsx`
- `BatchManager.tsx`
- `ParticleEmitter2Dialog.tsx`
- 其他大型 manager/modal

#### 建议手段

- 使用更细粒度 selector
- 只订阅必要字段
- 将重计算逻辑从 render 流程中抽离
- 避免大型对象引用频繁重建

#### 验收标准

- 明显减少拖动、输入、切换模式时的主线程负担

## P3：工程化与长期演进

### 1. Service 层收敛

#### 问题

当前部分业务逻辑散落在 UI 事件处理链中，导致组件过重。

#### 目标

让组件负责交互，业务逻辑交给 service。

#### 建议方向

- `modelTransformService`
- `modelValidationService`
- `modelExportService`
- `modelPreviewService`
- `nodeEditorSessionService`

#### 验收标准

- 复杂业务逻辑不再主要堆在组件内部
- UI 与模型处理逻辑职责更清楚

### 2. 模型分析面板

#### 目标

增加一个对用户和开发都高价值的诊断面板。

#### 建议内容

- 顶点数、面数、节点数、粒子节点数
- 包围盒是否缺失
- PivotPoints 是否异常
- 是否存在无效贴图/材质引用
- 动画轨道是否损坏
- 未使用资源统计

#### 价值

- 帮助用户理解“为什么这个模型编辑会异常”
- 帮助开发快速确认问题属于数据缺陷还是程序缺陷

### 3. 最小自动化测试体系

#### 目标

不是一次性补全测试，而是先覆盖最值钱的纯逻辑路径。

#### 第一批建议测试点

- 过滤模式映射
- 粒子参数写回与预览合并逻辑
- 全局 gizmo 锚点计算
- MDL 文本导入导出
- 模型清理与修复函数

#### 建议形式

- 先做 utility / service / store 级单测
- 暂不优先做大量 UI 截图测试

### 4. 文档化开发约束

建议额外补一份开发约束文档，例如：

- 如何处理用户可见中文文案
- 如何写新的独立窗口编辑器
- 如何接入 history
- 如何接入实时预览
- 如何避免跨窗口消息过载

## 推荐执行顺序

### Sprint 1：稳定性收口

范围：

- 文案抽离
- UTF-8 清理
- Error Boundary
- 回归清单

目标：

- 不再因为局部报错或乱码导致整块 UI 不可用

### Sprint 2：状态边界治理

范围：

- 粒子编辑器
- 节点编辑器
- 材质编辑器

目标：

- Session State / Preview State / Document State 分层
- history 行为统一

### Sprint 3：性能治理

范围：

- 跨窗口预览桥
- Viewer gizmo 与 anchor 计算拆分
- 缩略图调度队列

目标：

- 降低卡顿
- 降低重复计算
- 解决高频交互掉帧

### Sprint 4：工程化完善

范围：

- service 分层
- 模型分析面板
- 最小自动化测试
- 开发约束文档

目标：

- 让后续功能开发可持续，而不是继续累积技术债

## 建议的首批文件落点

如果下一步开始真正实施，建议优先改这些位置：

- `src/renderer/src/components/Viewer.tsx`
- `src/renderer/src/components/MainLayout.tsx`
- `src/renderer/src/components/MenuBar.tsx`
- `src/renderer/src/components/node/ParticleEmitter2Dialog.tsx`
- `src/renderer/src/components/node/NodeDialog.tsx`
- `src/renderer/src/components/batch/BatchManager.tsx`
- `src/renderer/src/store/modelStore.ts`
- `src/renderer/src/store/rendererStore.ts`
- `src/renderer/src/store/selectionStore.ts`
- `src/renderer/src/services/*`
- `src/renderer/src/utils/*`

## 下一位 AI 建议的开工方式

不要从“随便挑一个组件开始重构”入手，建议按下面顺序推进：

1. 先建立文档与约束
2. 再处理稳定性和状态边界
3. 最后再做性能和工程化扩展

推荐第一个实际任务：

- 先落地 `P0`，完成文案抽离、错误边界、回归清单

推荐第二个实际任务：

- 把 `ParticleEmitter2Dialog.tsx` 的 session/preview/document 分层机制抽成公共模式

推荐第三个实际任务：

- 将 `Viewer.tsx` 中 gizmo anchor / global transform / hit test 拆分成独立模块

## 完成定义

本路线图不要求一次性做完，而是要求每个阶段完成后满足以下标准：

- 有明确改动边界
- 有最小验证方式
- 不引入新的高频回归
- 能被下一位维护者快速理解并接手

如果后续文档需要拆分，建议从本文件继续衍生出：

- `docs/Regression_Checklist.md`
- `docs/Editor_State_Architecture.md`
- `docs/Viewer_Performance_Plan.md`
- `docs/Batch_Mode_Optimization.md`

