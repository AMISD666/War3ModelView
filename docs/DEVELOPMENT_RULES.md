# Development Rules

本文档是 War3ModelView 的完整工程规则。目标是让后续开发更专业、更容易维护、更容易加入新功能，并避免继续出现巨型文件、平行接口、隐式业务流程和难以验证的修改。

## 1. 核心目标

项目后续开发必须满足这些目标：

- 每个功能有清晰的唯一入口。
- UI、应用编排、状态、基础设施、vendor/Rust 之间保持边界。
- 大文件只减不增，新功能优先拆到小模块。
- 模型编辑、保存、导出、渲染同步、跨窗口同步走统一流程。
- 验证脚本必须真实存在，规则尽量能被命令检查。
- 文档、代码、脚本都使用 UTF-8，避免中文乱码继续扩散。

## 2. 权威入口

规则层级如下：

```text
AGENTS.md                         # 第一入口，短规则，强约束
docs/DEVELOPMENT_RULES.md         # 完整工程规则
scripts/check-architecture-guardrails.mjs
                                  # 自动守门脚本
README.md                         # 项目介绍和文档链接
.codex/、.agent/rules/、.github/hooks/
                                  # 工具配置，不作为工程规则源
```

以后如果新增团队规则，优先更新 `AGENTS.md` 和本文档，不要把工程规则分散写进多个工具私有配置里。

## 3. 当前项目分层

当前项目主要技术栈：

- 前端：React 18、TypeScript、Vite、Ant Design、Zustand、Web Worker。
- 桌面层：Tauri 2、Rust。
- 模型/渲染：`mdx-m3-viewer`、`vendor/war3-model`、`vendor/blp-rs`。
- IPC/序列化：Tauri commands、`@msgpack/msgpack`、renderer workers。

核心目录职责：

- `src/renderer/src/components`：React UI、面板、弹窗、Viewer 外壳、编辑器界面。
- `src/renderer/src/application`：用例编排、工作流、命令处理、窗口桥接、打开/保存/验证/渲染同步。
- `src/renderer/src/commands`：可撤销/可重放的模型编辑命令对象。
- `src/renderer/src/store`：Zustand 状态，保持薄状态层。
- `src/renderer/src/infrastructure`：Tauri、文件系统、窗口、序列化、纹理、渲染、更新、外部库 gateway。
- `src/renderer/src/services`：领域服务。
- `src/renderer/src/workers`：耗时任务、模型处理、贴图处理、RPC 编解码。
- `src/renderer/src/utils`：小型纯函数和低耦合工具。
- `src-tauri/src`：Rust/Tauri 后端命令、MPQ、贴图编解码、激活、文件复制删除、安全路径。
- `vendor`：第三方/移植库，默认不承载应用业务逻辑。

## 4. 统一调用方向

所有新功能必须遵循单向调用：

```text
components
  -> application/workflow or application/commands
  -> services / commands / store
  -> infrastructure gateways
  -> Tauri Rust / vendor / workers
```

禁止新增这些方向：

```text
components -> @tauri-apps/api/core invoke(...)
components -> vendor 深层模块
components -> 复杂模型写操作
components -> 保存/导出/渲染同步完整流程
store -> React 组件
vendor -> application/components
Rust command -> 前端 UI 概念
```

组件可以调用 `application` 或已有 command handler；不允许为了方便在组件中散落 Tauri invoke、文件系统插件、vendor 深层 import、模型序列化细节。

## 5. 新功能入口规则

新增功能开发前必须先回答：

- 这个功能的唯一入口文件在哪里？
- 是否需要撤销/重做？如果需要，command 在哪里？
- 是否需要 store 状态？状态能否拆成 selector、slice 或 service？
- 是否需要 Tauri/Rust？前端 gateway 是否已定义？
- 是否需要 worker？消息协议类型在哪里？
- 是否触碰 vendor？为什么不能通过 adapter/gateway 解决？
- 保存、导出、预览、跨窗口同步是否都能走同一套接口？

推荐入口：

- 打开模型：`src/renderer/src/application/model-open`
- 保存模型：`src/renderer/src/application/model-save`
- 模型编辑：`src/renderer/src/commands` 或 `src/renderer/src/application/commands`
- 渲染同步：`src/renderer/src/application/render`
- 模型校验/修复：`src/renderer/src/application/model-validation`
- 模型工具：`src/renderer/src/application/model-tools` 或明确领域 service
- 纹理解码/预览：`src/renderer/src/infrastructure/texture` + `src/renderer/src/application/preview`
- 序列化：`src/renderer/src/infrastructure/serialization`
- 窗口通信：`src/renderer/src/application/window-bridge` + `src/renderer/src/infrastructure/window`
- Tauri 能力：`src/renderer/src/infrastructure/*Gateway`

## 6. 文件规模规则

文件规模要用“目标线、警戒线、冻结线”管理。

| 类型 | 目标 | 警戒 | 冻结 |
| --- | ---: | ---: | ---: |
| 普通 `.ts` 业务文件 | 300 行 | 500 行 | 1200 行 |
| React `.tsx` 组件 | 250 行 | 400 行 | 600 行 |
| 复杂编辑器/面板 `.tsx` | 300 行 | 600 行 | 1200 行 |
| Zustand store | 400 行 | 700 行 | 1200 行 |
| Worker | 400 行 | 600 行 | 1000 行 |
| Rust 普通模块 | 300 行 | 500 行 | 1000 行 |
| Rust command 模块 | 500 行 | 800 行 | 1200 行 |

冻结线含义：

- 非 vendor 文件超过冻结线后，禁止新增大型功能。
- 已超限文件只允许抽离、修 bug、小范围接线。
- 如确实需要临时改动，必须在交付说明中说明原因和后续拆分计划。
- 新文件超过警戒线必须优先拆分，不能先堆成大文件再说。

当前重点冻结名单：

- `src/renderer/src/components/viewer/ViewerImpl.tsx`
- `src/renderer/src/components/animation/Timeline/TimelinePanel.tsx`
- `src/renderer/src/store/modelStore.ts`
- `src/renderer/src/components/MainLayout.tsx`
- `src/renderer/src/utils/modelOptimization.ts`
- `src/renderer/src/components/modals/TextureEditorModal.tsx`
- `src/renderer/src/components/modals/MaterialEditorModal.tsx`
- `src/renderer/src/components/editors/UVEditor.tsx`
- `src/renderer/src/components/node/ParticleEmitter2Dialog.tsx`
- `src/renderer/src/application/model-save/prepareModelDataForSave.ts`
- `src/renderer/src/components/viewer/textureLoader.ts`
- `src-tauri/src/main.rs`
- `vendor/war3-model/renderer/modelRenderer.ts`

## 7. 大文件拆分方向

### Viewer

`ViewerImpl.tsx` 后续只允许接入已抽离模块，不应继续放大。推荐拆分方向：

- `useViewerLifecycle`
- `useViewerWorkers`
- `useViewerSelection`
- `useViewerTexturePipeline`
- `useViewerModelSync`
- `ViewerCanvasSurface`
- `ViewerOverlays`
- `ViewerInputController`
- `ViewerRenderController`

### Timeline

`TimelinePanel.tsx` 推荐拆分：

- 时间轴渲染组件
- 轨道列表组件
- 关键帧选择 hook
- 拖拽/缩放交互 hook
- 上下文菜单组件
- 时间/帧数据转换纯函数

### Store

`modelStore.ts` 推荐拆分：

- document slice
- selection slice
- texture/material slice
- animation slice
- renderer sync slice
- save/open orchestration 迁到 `application`
- selectors 独立文件

### Rust

`src-tauri/src/main.rs` 推荐只保留：

- Tauri builder
- plugin 注册
- command 注册
- 模块 wiring

业务实现按领域拆到 `app_paths.rs`、`mpq_manager.rs`、`texture_decode.rs`、`texture_encode.rs`、`activation.rs`、`copy_utils.rs`、`delete_utils.rs` 或新的领域模块。

## 8. 前端规则

组件规则：

- 组件只做展示、布局、轻量交互和事件转发。
- 组件内部不要写复杂模型转换、保存、导出、跨窗口同步。
- 复杂表单/编辑器必须拆子组件、hook、constants、types、presenter/controller。
- 弹窗组件不应成为完整业务流程容器，保存/应用逻辑应下沉到 application service 或 command handler。

状态规则：

- Store 只保存状态、简单 action 和必要的同步标记。
- Store 不直接依赖 React 组件。
- Store 不直接承载长流程业务。
- 复杂逻辑迁到 `application`、`services` 或 `commands`。

Command 规则：

- 可撤销模型编辑必须走 `CommandBus` 或领域 command handler。
- command 内不要直接做 UI、Tauri IPC、弹窗、全局通知。
- command 必须能清晰表达 `execute`、`undo`、必要时 `redo`。
- 修改模型引用关系后必须保留完整性校验链路。

Gateway 规则：

- Tauri、文件系统、窗口、更新、纹理解码、序列化等外部能力必须经 `infrastructure/*Gateway`。
- 前端组件不直接 import `@tauri-apps/api/*` 或 `@tauri-apps/plugin-*`。
- Gateway 接口和实现分离，便于测试和替换。

Worker 规则：

- Worker 协议类型单独放置，避免和实现混写。
- Worker 消息包含请求 id、类型、payload、错误返回。
- Worker 不依赖 React 组件、Zustand store 或 DOM。

## 9. Rust/Tauri 规则

- `main.rs` 只做启动、插件、command 注册和薄胶水。
- 新 command 必须拆到领域模块。
- command 输入输出必须使用 `serde` 类型。
- 错误返回应结构化，至少包含可展示 message 和可诊断 context。
- 路径处理必须经过 `app_paths` 或安全路径工具。
- 删除、复制必须使用 `delete_utils`、`copy_utils` 或同级安全封装。
- 文件系统、注册表、剪贴板、网络、激活、MPQ、纹理编解码保持模块边界。
- 前端只能通过 gateway 调用 Rust command。

## 10. Vendor 规则

`vendor/` 默认是第三方/移植代码。不要为了业务便利随意深改。

`war3-model` 运行时固定走仓库内 `vendor/war3-model`，该目录必须与相邻正确渲染库
`../war3-model-4.0.0` 保持同步。粒子渲染已用该 4.0.0 库验证为正确，因此不要把
`war3-model` 改回 `node_modules` 副本，也不要在业务代码或 Vite 配置中写死外部绝对路径。
刷新库时运行 `npm run sync:war3-model`，提交或排查前运行
`npm run check:war3-model-vendor` 确认 vendor 未漂移。

允许修改 vendor 的条件：

- 上游没有可用扩展点。
- 必须修复格式兼容、解析、导出或渲染底层 bug。
- 项目侧 adapter/gateway 无法解决。

修改 vendor 必须说明：

- 原因。
- 影响范围。
- 是否可上游同步。
- 使用的模型样例或回归路径。
- 需要运行的验证命令。

业务层不得到处直接 import vendor 深层文件。优先通过这些层封装：

- `src/renderer/src/infrastructure/serialization`
- `src/renderer/src/infrastructure/render`
- `src/renderer/src/infrastructure/texture`
- `src/renderer/src/application/render`

## 11. 命名规则

- React 组件：`PascalCase.tsx`。
- hooks：`useXxx.ts`。
- service：`XxxService.ts`。
- workflow：`XxxWorkflow.ts`。
- use case：`XxxUseCase.ts`。
- gateway 接口：`XxxGateway.ts`。
- gateway 实现：`tauriXxxGateway.ts`、`war3XxxGateway.ts`、`viewerXxxGateway.ts`。
- 类型：跨模块共享放 `types/`，feature 内共享放 `types.ts`。
- 常量：feature 内 `constants.ts`，全局常量放 `constants/`。
- Rust：模块和函数使用 `snake_case`，类型使用 `PascalCase`。

## 12. 错误处理和接口规则

- 业务层返回结构化错误，UI 层负责展示。
- 底层 service 不直接弹窗、不直接写 UI 状态。
- 保存、导出、解析、渲染同步必须保留可追踪错误上下文。
- 路径处理统一使用既有 path helper，避免手写分隔符。
- 跨窗口通信必须有明确事件名、payload 类型和生命周期清理。
- 模型数据变更应尽量使用不可变快照或明确 clone 策略，避免共享引用导致历史记录失效。

## 13. 验证规则

按影响面选择验证：

- 架构守门：`npm run check:architecture`
- 前端类型：`npm run typecheck:web`
- Node/Vite/脚本类型：`npm run typecheck:node`
- 全量类型：`npm run typecheck`
- 前端构建：`npm run build`
- MDX/MDL 严格导出：`npm run check:mdx-strict-export`
- 状态同步基础检查：`npm run check:state-sync-fixtures`
- Rust/Tauri：在 `src-tauri/` 执行 `cargo check`

影响面和验证对应关系：

- 改普通前端业务：至少 `npm run typecheck:web`。
- 改构建、脚本、配置：`npm run typecheck:node` 和相关脚本。
- 改模型格式、导入、导出：`npm run check:mdx-strict-export`，并手动做 MDL/MDX 往返。
- 改保存流程：打开模型、保存 MDL、保存 MDX、重新打开验证。
- 改 Viewer/渲染：验证模型加载、贴图、动画、节点、粒子、丝带、相机。
- 改窗口桥接：验证主窗口和独立工具窗口打开、同步、关闭、恢复。
- 改 Rust/Tauri：`cargo check`，必要时再 `npm run build`。
- 改 vendor：必须说明样例模型和回归路径。

## 14. 变更流程

每次开发按这个流程：

1. 检查工作区，识别用户已有改动。
2. 定位已有入口，避免新建平行流程。
3. 判断影响面：模型数据、保存导出、渲染同步、历史记录、窗口通信、Tauri、vendor、性能。
4. 设计最小接口：输入、输出、错误、状态流向。
5. 先拆分再接入，尤其是触碰巨型文件时。
6. 根据影响面运行验证。
7. 如果新增架构入口、脚本或重要约定，更新 `AGENTS.md` 或本文档。

## 15. 编码和文档规则

- Markdown、TS、TSX、JS、MJS、Rust、JSON、TOML 使用 UTF-8。
- 中文文档保存为 UTF-8，避免因为终端编码造成误判。
- 新文档放 `docs/`，README 只保留入口链接和最小使用说明。
- 重要设计文档包含：背景、目标、非目标、影响范围、入口文件、验证方式、回滚方式。
- 搜索、统计、审查时默认排除 `node_modules`、`src-tauri/target`、`target`、`out`、`dist`、`build`、`release`、`.git`。

## 16. 自动检查

`npm run check:architecture` 至少检查：

- 规则文档是否存在。
- package scripts 指向的规则脚本是否存在。
- 非 vendor 源码是否出现新的超大文件。
- 已有巨型文件是否超过基线。
- React 组件是否直接 import Tauri API 或插件。
- React 组件是否直接 import vendor 深层实现。

自动检查不能替代工程判断。脚本通过只表示没有踩到基础红线；触碰复杂模型流程时仍必须按影响面验证。
