# War3ModelView WebGPU 落地实施方案 (WebGL -> WebGPU)

目标：把当前“以 WebGL 为主、WebGPU 试验性”的渲染链路，升级为“WebGPU 优先、WebGL 可靠回退”的生产可用方案，并能在 Tauri 桌面端稳定渲染模型。

这份方案强调两件事：
1. WebGPU 是否可用首先是“运行时 WebView 能力”问题，不是渲染代码写了就一定能开。
2. WebGPU 渲染必须按“单帧单次 swapchain 纹理获取 + 单次提交”组织，否则 overlay/网格/轴指示器很容易出现黑屏或只显示一部分。

## 0. 前置条件 (必须先验收)

### 0.1 运行时支持矩阵
- Windows(Tauri/WebView2)：要求 WebView2 Runtime + GPU/驱动支持 WebGPU；如果 `navigator.gpu` 为 `false`，必须提供清晰提示并回退 WebGL。
- macOS/Linux：默认按 “Auto=WebGL” 策略，只有明确验证 webview 支持 WebGPU 才允许开启。

### 0.2 可观测性与诊断
实现一个最小诊断输出（console + 可选 UI）：
- `navigator.gpu` 是否存在
- `requestAdapter()` 是否返回 adapter
- `requestDevice()` 是否成功
- `canvas.getContext('webgpu')` 是否为 null
- `device.lost` 监听与错误信息

验收标准：当 WebGPU 不可用时，必须能看见“不可用原因”而不是无声失败。

## 1. 架构方向

### 1.1 双后端 (WebGL/WebGPU) 并存
- `ModelRenderer` 同时支持 WebGL 与 WebGPU。
- 前端通过 `useRendererStore.useWebGPU` 控制尝试 WebGPU；失败必须回退 WebGL。

### 1.2 单帧合成 (Frame Composition)
WebGPU 推荐每帧：
- `getCurrentTexture()` 只调用一次
- 在同一个 `GPUCommandEncoder` / `GPURenderPassEncoder` 里渲染：模型 + 网格 + 轴指示器 + 其它 overlay
- 最后只 `queue.submit()` 一次

为此需要一个“可合成的渲染入口”。本仓库已引入：
- `ModelRenderer.renderGPUComposite(targetView, mv, p, options, afterRender(pass))`
  - `targetView` 由宿主应用在一帧内获取一次并传入
  - `afterRender(pass)` 用于在同一 pass 内编码 overlay

## 2. 分阶段实施计划 (可落地)

### Phase A: 能开起来 (1-2 天)
- 统一 WebGPU 初始化与持久引用
  - `GPUDevice`、`GPUCanvasContext` 用 `useRef` 保存，渲染循环只读 ref
- 加诊断输出与回退策略
  - `useWebGPU=true` 但 `navigator.gpu` 不存在：提示并回退 WebGL
  - `requestAdapter/device` 失败：提示并回退 WebGL

验收：在支持 WebGPU 的机器上能稳定进入 WebGPU；不支持时稳定回退。

### Phase B: 画面稳定 (核心) (1-3 天)
- 改造渲染循环为“单帧单次获取 swapchain 纹理 + 单次提交”
  - 在宿主侧获取 `targetView = gpuContext.getCurrentTexture().createView()`
  - 调用 `renderGPUComposite(..., afterRender)`，在回调中渲染 grid/axis 等 overlay
- 辅助渲染器改为“在已有 pass 里渲染”
  - `AxisIndicator.renderGPU(pass, device, ...)` 不再自行 `submit`

验收：WebGPU 模式下网格/轴指示器不再随机消失、黑屏或与模型不同步。

### Phase C: 功能对齐与差异管理 (按模块推进)
- 列出必须 parity 的清单
  - 透明混合模式(FilterMode)一致性
  - 粒子/飘带
  - 线框/选中/hover 高亮
  - Gizmo/DebugRenderer
- 每个功能给出固定对比模型与截图用例

### Phase D: 性能与健壮性
- BindGroup/Uniform 更新策略优化（缓存/池化/ring buffer）
- 处理 resize/reconfigure、device lost
- 纹理/Buffer 缓存失效策略与内存回收

## 3. 风险点与对策
- 风险：Tauri/WebView2 不支持或未启用 WebGPU
  - 对策：明确诊断信息 + 默认回退 WebGL；必要时在 Windows 侧研究 WebView2 启用参数/版本要求
- 风险：多处 `getCurrentTexture()` 导致同帧内容分裂
  - 对策：强制走 `renderGPUComposite`，overlay 统一通过回调编码

## 4. 当前仓库已做的关键改造 (为落地铺路)
- 引入 `vendor/war3-model`，避免依赖外部同级目录，便于直接迭代 WebGPU 渲染实现。
- `ModelRenderer` 增加 `renderGPUComposite(...)`，并让 `render()` 在 WebGPU 模式下转发到该入口。
- `Viewer.tsx` 引入 `gpuContextRef`，并在 WebGPU 模式下用 `renderGPUComposite` 在同一 pass 内渲染 grid/axis。
- `AxisIndicator` 的 WebGPU 渲染改为“只编码，不 submit”。
