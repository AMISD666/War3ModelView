# Project Development Rules

本文件是本仓库的永久开发规则入口。所有人工协作者和 AI agent 在修改代码前都必须先遵守这里的约束；完整说明见 `docs/DEVELOPMENT_RULES.md`。

## Source Of Truth

- 根规则入口：`AGENTS.md`
- 完整规则文档：`docs/DEVELOPMENT_RULES.md`
- 自动守门脚本：`npm run check:architecture`
- `.codex/`、`.agent/rules/`、`.github/hooks/` 只用于工具配置，不承载项目工程规则。

## Architecture Direction

项目是 War3 模型编辑器，主要由 React/Vite/TypeScript 前端、Tauri/Rust 桌面层、vendor 模型/纹理/渲染库组成。新增功能必须保持单向调用：

```text
components -> application/workflow/commands -> services/store -> infrastructure gateways -> Tauri/vendor/workers
```

禁止新增这些调用方式：

- React 组件直接调用 `@tauri-apps/api/core` 的 `invoke(...)`。
- React 组件直接 import vendor 深层实现。
- UI 组件承载模型保存、导出、渲染同步、跨窗口同步等业务编排。
- Zustand store 承载复杂业务流程。
- vendor 代码承载应用业务逻辑。

## Feature Entry Rules

新增功能必须先定义唯一入口，再接 UI：

- 打开模型：走 `src/renderer/src/application/model-open`。
- 保存模型：走 `src/renderer/src/application/model-save`。
- 模型编辑：走 `src/renderer/src/commands` 或 `src/renderer/src/application/commands`，需要撤销/重做的改动必须进入 command 流程。
- 渲染同步：走 `src/renderer/src/application/render`。
- 窗口通信：走 `src/renderer/src/application/window-bridge` 和 `src/renderer/src/infrastructure/window`。
- Tauri、文件系统、序列化、贴图、更新等外部能力：走 `src/renderer/src/infrastructure/*Gateway`。

## File Size Limits

新增代码不允许继续制造超大文件：

- 普通 `.ts` 文件目标小于 300 行，超过 500 行需要拆分理由。
- `.tsx` 组件目标小于 250 行，复杂编辑器/面板最多 400 行，超过 600 行必须拆分。
- Zustand store 目标小于 400 行，超过 700 行必须拆 slice、selector 或 service。
- Worker 文件目标小于 400 行，协议类型、消息处理、算法实现分开。
- Rust 普通模块目标小于 300 行，command 模块最多 500 行；`src-tauri/src/main.rs` 只做启动、插件、注册和薄胶水。
- 非 vendor 文件超过 1200 行后进入冻结增肥状态：只允许抽离、修 bug、小范围接线，不允许继续塞新功能。

已有巨型文件必须优先减小，不得继续承载大块新逻辑，重点包括：

- `src/renderer/src/components/viewer/ViewerImpl.tsx`
- `src/renderer/src/components/animation/Timeline/TimelinePanel.tsx`
- `src/renderer/src/store/modelStore.ts`
- `src/renderer/src/components/MainLayout.tsx`
- `src/renderer/src/utils/modelOptimization.ts`
- `src/renderer/src/components/modals/TextureEditorModal.tsx`
- `src/renderer/src/components/modals/MaterialEditorModal.tsx`
- `src-tauri/src/main.rs`
- `vendor/war3-model/renderer/modelRenderer.ts`

## Frontend Rules

- `components/` 只负责 UI 组合、展示、轻量交互。
- `application/` 放用例编排、工作流、命令处理、窗口桥接、保存/打开/验证/渲染同步。
- `commands/` 放可撤销、可重放的模型编辑命令。
- `store/` 只保存状态和很薄的 action，复杂业务迁到 `application/` 或 `services/`。
- `infrastructure/` 放 Tauri、文件系统、窗口、序列化、贴图、更新、外部库 gateway。
- `utils/` 只放小型纯函数；超过 300 行或依赖业务上下文的工具应迁移到明确领域目录。
- Worker 只处理隔离计算，不依赖 React 组件或 UI 状态。

## Rust And Vendor Rules

- 新 Tauri command 不得把大段实现写进 `main.rs`，必须按领域拆到独立模块。
- Rust command 输入输出使用稳定的 `serde` 类型，不从前端传任意松散 JSON 后手写解析。
- 路径、删除、复制、网络、注册表、激活、MPQ、纹理编解码等敏感能力必须走对应安全封装。
- `vendor/` 默认视为第三方/移植代码。业务需求优先通过项目侧 adapter/gateway 扩展。
- 修改 vendor 必须说明原因、影响范围、验证样例；`dist/generated/third_party` 原则上不手改。

## Naming Rules

- React 组件：`PascalCase.tsx`，主组件与文件同名。
- hooks：`useXxx.ts` 或放在 feature 的 `hooks/`。
- service/use case/workflow：`XxxService.ts`、`XxxUseCase.ts`、`XxxWorkflow.ts`。
- gateway/adapter：接口用 `XxxGateway.ts`，实现用 `tauriXxxGateway.ts`、`war3XxxGateway.ts` 等。
- 跨模块类型放 `types/` 或 feature 内 `types.ts`，避免在大组件内部定义外部依赖类型。
- Rust command 使用 `snake_case`，前端 gateway 使用语义化 `camelCase` 方法。

## Validation

按影响面运行验证：

- 架构守门：`npm run check:architecture`
- 前端类型：`npm run typecheck:web`
- 全量类型：`npm run typecheck`
- 前端构建：`npm run build`
- MDX/MDL 严格导出：`npm run check:mdx-strict-export`
- Rust/Tauri：在 `src-tauri/` 执行 `cargo check`

`package.json` 中声明的验证脚本必须真实存在并保持可运行。若某次无法运行验证，必须在交付说明中写明原因。

## Change Discipline

- 修改前先检查当前工作区，不得回退用户已有改动。
- 新功能先找已有入口，避免建立平行链路。
- 触碰模型格式、保存、导出、渲染同步、缓存、状态提交完整性时，必须保持结构化接口和可追踪错误。
- 所有文本文件使用 UTF-8。编辑已有中文乱码相关文件时，先确认编码，避免扩大乱码范围。
