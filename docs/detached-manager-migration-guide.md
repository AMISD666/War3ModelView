# 贴图管理器独立窗口方案与管理器迁移指南

本文用于给下一个 AI 直接接手，目标是把其他管理器改造成与贴图管理器一致的“系统级窗口承载面板”方案，同时保留主流程兼容。

## 1. 目标与约束

目标：
1. 管理器以 Tauri 系统级窗口承载，不受主界面边界限制，可拖到桌面。
2. 窗口内容是面板本体，不再套一层 `DraggableModal` 模拟弹窗。
3. 修改即时生效，尽量用增量同步降低延迟。
4. 保留主流程兼容：同一组件可同时支持“主界面弹窗模式”和“独立窗口模式”。

约束：
1. 不新增外部进程，不调用 `cmd` 或 `shell.open` 拉起独立程序。
2. 主窗口关闭时，所有附属窗口必须跟随关闭。
3. 事件权限必须在 Tauri capability 中声明对应窗口标签。

## 2. 当前贴图管理器是如何实现的

## 2.1 关键文件

1. 路由与 detached 入口：`src/renderer/src/App.tsx`
2. detached 协议常量：`src/renderer/src/constants/detachedWindows.ts`
3. detached 贴图窗口容器：`src/renderer/src/components/detached/TextureEditorDetachedWindow.tsx`
4. 主窗口创建/同步逻辑：`src/renderer/src/components/MainLayout.tsx`
5. 贴图编辑器双形态组件：`src/renderer/src/components/modals/TextureEditorModal.tsx`
6. Tauri 权限窗口白名单：`src-tauri/capabilities/default.json`

## 2.2 数据流（贴图管理器）

1. 主窗口创建 `WebviewWindow(label=texture_editor_window)`，URL 带 `/?detached=texture-editor`。
2. detached 页加载后进入 `TextureEditorDetachedWindow`，监听 `snapshot` 和 `delta` 事件。
3. detached 发 `request-snapshot` 给 `main` 拉初始快照。
4. 主窗口回传完整 `snapshot`（含 `revision`）。
5. 后续主窗口尽量发送 `delta`（add/remove/update），detached 本地合并。
6. detached 内编辑后通过 `apply` 回写主窗口。
7. 主窗口 `setTextures`，再继续向 detached 同步最新状态。

这个链路已经实现了“首包快照 + 增量同步 + 回写主状态”的闭环。

## 2.3 为什么贴图管理器看起来更像“原生窗口”

`TextureEditorModal` 支持 `asWindow`：
1. `asWindow=false`：走旧版 `DraggableModal`，兼容主界面弹窗。
2. `asWindow=true`：直接返回页面容器，不渲染 `DraggableModal`、标题栏、Save/Cancel 模拟按钮。

`TextureEditorDetachedWindow` 传入 `asWindow={true}`，所以 detached 窗口里是“面板本体”而不是“窗口内套弹窗”。

## 3. 其他管理器当前痛点

目前 `DetachedManagerWindow` 虽然已经能开系统窗口，但内部仍直接挂载旧组件：
1. `CameraManagerModal`
2. `GeosetEditorModal`
3. `GeosetAnimationModal`
4. `TextureAnimationManagerModal`
5. `MaterialEditorModal`
6. `SequenceEditorModal`
7. `GlobalSequenceModal`

这些组件大多只支持 `DraggableModal`，所以会出现“系统窗口里还嵌一个模拟弹窗”的观感和交互冗余。

## 4. 统一迁移方案（推荐执行顺序）

## 4.1 第一步：组件改为双形态（必须）

对每个管理器组件增加：
1. `asWindow?: boolean`，默认 `false`。
2. 抽离 `renderContent()`，把正文 UI 独立出来。
3. `asWindow=true` 时直接返回全屏容器 + `renderContent()`。
4. `asWindow=false` 时保持原 `DraggableModal` 包裹，保证主流程不受影响。

这一步完成后，功能逻辑不变，仅改“承载壳”。

## 4.2 第二步：detached 容器传 `asWindow=true`

在 `DetachedManagerWindow` 里，把各管理器挂载改为：
1. `<XxxModal visible={true} asWindow={true} ... />`
2. 关闭行为仍调用 `getCurrentWindow().close()`

注意：
1. 独立窗口下去掉重复标题、Save/Close 模拟按钮，改为即时应用。
2. 主窗口弹窗模式保留原按钮行为（兼容旧工作流）。

## 4.3 第三步：同步协议从“整模型 apply”升级为“模块增量 apply”

当前 manager 通道主要是整份 `modelData` 回写，体积大、延迟高。建议迁移到按模块差量：
1. 快照事件：`detached:manager:<type>:snapshot`
2. 增量事件：`detached:manager:<type>:delta`
3. 回写事件：`detached:manager:<type>:apply`

每类 manager 定义最小操作集：
1. `add`
2. `remove`
3. `update`
4. `reorder`（如序列、材质层常用）

并带上 `revision`，避免乱序覆盖。

## 4.4 第四步：镜头管理器用事件驱动主 Viewer

镜头管理器有两个主窗口上下文能力：
1. 从当前视角创建相机
2. 让主 Viewer 跳到选中相机视角

不应在 detached 内做空实现，应通过事件桥接：
1. detached 发 `detached:camera:add-from-view`、`detached:camera:view`
2. 主窗口监听后调用现有 Viewer 方法执行
3. 执行结果再同步回 detached（delta 或 snapshot）

## 4.5 第五步：窗口生命周期与兼容兜底

1. 主窗口关闭路径统一调用 `closeAuxiliaryWindows()`。
2. detached 创建失败时，可回退到主界面弹窗模式（可选兜底）。
3. detached 侧保留“请求快照重试”，避免启动竞争导致 `No model snapshot`。

## 5. capability 与事件权限清单

`src-tauri/capabilities/default.json` 的 `windows` 需包含全部标签：
1. `main`
2. `texture_editor_window`
3. `manager_window_camera`
4. `manager_window_geoset`
5. `manager_window_geosetAnim`
6. `manager_window_textureAnim`
7. `manager_window_material`
8. `manager_window_sequence`
9. `manager_window_globalSequence`

注意：修改 capability 后必须重启 Tauri 进程，否则新窗口事件权限可能不生效。

## 6. 建议协议模板（给下个 AI 直接套）

以 `material` 为例：
1. `detached:manager:material:request-snapshot`
2. `detached:manager:material:snapshot`
3. `detached:manager:material:delta`
4. `detached:manager:material:apply`

payload 最小化建议：
1. snapshot：`{ modelPath, revision, materials, texturesRef }`
2. delta：`{ revision, ops: [{ type, index, value }] }`
3. apply：`{ revisionBase, ops }`

主窗口处理：
1. 校验 `revisionBase` 不落后。
2. 将 `ops` 应用到 store 指定模块。
3. 成功后广播新 revision 的 delta/snapshot 给对应 detached 窗口。

## 7. UI 规范（独立窗口）

1. 不再显示 `DraggableModal` 标题栏和底部确认按钮。
2. 顶部工具栏仅保留必要动作，普通字段改“失焦提交”或“短防抖提交”。
3. 视觉风格沿用主程序主题变量，避免“嵌套弹窗”观感。
4. 大数据列表必须分页或虚拟滚动，避免首开卡顿。

## 8. 排错手册

问题：`No model snapshot from main window`
1. 先查 capability 是否包含该窗口 label。
2. 确认 `App.tsx` 能识别对应 `?detached=manager-*` 路由。
3. 确认主窗口 listeners 已注册 `requestSnapshot` 并回发到正确 label。
4. 检查 detached 是否带重试机制。
5. capability 修改后重启应用再测。

问题：看起来像“窗口里嵌弹窗”
1. 说明该 manager 还没实现 `asWindow` 分支。
2. detached 容器未传 `asWindow={true}`。

问题：延迟高
1. 还在整份 `modelData` 回写。
2. 改为模块增量 `ops`。
3. 大文本输入改 `blur` 提交或 80~120ms 防抖。

## 9. 七个管理器的落地任务拆分

建议按以下顺序实施并逐个验收：
1. `MaterialEditorModal`
2. `TextureAnimationManagerModal`
3. `GeosetAnimationModal`
4. `GeosetEditorModal`
5. `SequenceEditorModal`
6. `GlobalSequenceModal`
7. `CameraManagerModal`（最后做，因需 Viewer 事件桥接）

每个模块验收标准一致：
1. 系统窗口内不出现模拟弹窗壳。
2. 修改即时生效。
3. 主界面旧入口仍可用。
4. 主窗口关闭时附属窗口自动关闭。
5. 冷启动不再报 `No model snapshot from main window`。

