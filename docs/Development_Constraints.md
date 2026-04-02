# War3ModelView 开发约束

本文档用于约束高频改动区域，避免重复引入乱码、状态混写、窗口通信过载和不可撤销修改。

## 1. 用户可见文案

- 新增中文文案优先写入统一常量文件，例如 [`src/renderer/src/constants/uiText.ts`](../src/renderer/src/constants/uiText.ts)。
- 同一文案出现超过 3 次，必须抽离，不再在组件内重复写死。
- 修改历史文件时，优先保持 UTF-8 编码，不混用其他编码保存。
- 如果文件已出现乱码，先做小范围修复，再继续功能修改，避免把编码问题和业务修改混在同一次提交。

## 2. Error Boundary 接入规则

- 新增高风险区域时，默认评估是否接入 `AppErrorBoundary`。
- 以下场景应优先接入：
  - 主布局里的大型面板
  - 独立窗口内容区
  - 重型 modal 容器
  - Viewer 或高频渲染区域
- 接入原则：
  - 边界尽量包住完整功能区，而不是零散包住单个字段
  - 保证用户能看到局部失败，而不是整页白屏
  - 保留控制台错误输出，便于定位

## 3. 编辑器状态分层

高频编辑器默认按三层状态设计：

- `Document State`：真实模型数据，进入历史和保存链路
- `Session State`：当前弹窗或独立窗口的本地编辑态
- `Preview State`：仅供实时预览的临时值

约束如下：

- 打开编辑器时，从 `Document State` 复制出 `Session State`
- 拖动、输入过程中只更新 `Session State`
- 实时预览通过节流后的 `Preview State` 推送
- 点击保存、应用或确认关闭时，再提交回 `Document State`
- 不允许在输入过程里直接频繁污染真实模型数据

## 4. History / Undo 规则

- 用户可感知的模型修改，应进入统一的 history 链路。
- 不要在一个编辑器里混用“实时写回”和“关闭时一次性补 history”的两套策略。
- 如果暂时无法完全统一，应至少保证：
  - 保存后可撤销
  - 关闭后重开不会出现旧值和新值混杂
  - 独立窗口和主窗口行为一致

## 5. 跨窗口实时预览

- 独立窗口到主窗口的预览同步必须节流。
- 默认使用 `requestAnimationFrame` 或 `30~60ms` 节流，不允许每次输入都直接推送。
- `onChange` 负责更新本地态，`onAfterChange` / `blur` / 松手时再做一次稳定提交。
- 新增独立编辑器时，不要复制旧的窗口通信实现，应优先抽到公共 service。

## 6. Store 订阅与选择器

- 大型组件不要直接订阅整块 store。
- 优先通过 selector 或 hook 订阅最小切片。
- 避免在 render 期间构造大对象并直接作为依赖下传。
- 发现高频重渲染时，先检查订阅粒度，再考虑 `memo` 或其他局部优化。

## 7. 最低验证要求

- 涉及 UI 或编辑器行为的改动，至少跑一次 [`docs/Regression_Checklist.md`](./Regression_Checklist.md) 中对应项。
- 涉及构建链路、入口文件、窗口通信或共享常量时，至少执行一次 `npm run build`。
- 如果 `typecheck` 因历史债失败，应在任务说明中明确区分“历史问题”和“本次新增问题”。

## 8. 推荐落点

后续治理优先从这些位置继续推进：

- `src/renderer/src/components/node/ParticleEmitter2Dialog.tsx`
- `src/renderer/src/components/node/NodeDialog.tsx`
- `src/renderer/src/components/MainLayout.tsx`
- `src/renderer/src/components/Viewer.tsx`
- `src/renderer/src/components/batch/BatchManager.tsx`
- `src/renderer/src/store/*`
- `src/renderer/src/services/*`
