# Tauri 多窗口架构迁移指南 (Tauri Multi-Window Migration Guide)

本文档记录了将当前项目中原有的 Ant Design 模拟弹窗（Modal）逐步替换为 **操作系统级原生独立窗口 (WebviewWindow)** 的完整技术代码和实现细节。
此套架构已率在“模型优化”界面中试验成功，并达到了 **0毫秒延迟秒开、无白屏闪烁** 的极致原生客户端体验。

---

## 1. 核心思想：对象池预加载策略 (Object Pool Pattern)

由于 Chromium Webview 的引擎启动成本极高（100~300ms 延迟），我们绝对不能在用户点击按钮时才去构建窗口。

*   **暗中滋生 (Preload)**: 伴随主界面的启动，在后台静默创建好所有的悬浮子窗口（`visible: false`）。
*   **偷天换日 (Show)**: 用户点击打开窗口时，不创建新进程，直接对预加载的窗口实例调用 `win.show()`。
*   **金蝉脱壳 (Hide)**: 用户点击窗口右上角“X”关闭时，拦截销毁事件，改为调用 `win.hide()` 让其休眠在内存中。

---

## 2. 基础配置层修改 (Tauri Config)

要使子窗口享有完整的权限并能合法隐藏自己，必须在 `src-tauri/capabilities/default.json` 中补齐权限配置：

```json
{
    // 允许任何动态创建的子窗口继承主窗口相同的 API 权限
    "windows": [
        "main",
        "*"
    ],
    "permissions": [
        // 核心窗口控制权限
        "core:window:allow-show",
        "core:window:allow-hide",             // 【关键】允许子窗口主动隐藏自己
        "core:webview:allow-create-webview-window", // 【关键】允许渲染进程创建新原生窗口
        // ... (其他权限)
    ]
}
```

---

## 3. 防闪烁渲染优化 (HTML 层)

为了追求极致秒开，防止原生系统调用 Chromium 时出现哪怕一帧的白屏或遗留的“加载中”旋转骨架。

**修改 `src/renderer/index.html`**：
在 `<head>` 中强硬注入深色背景；在骨架屏中注入瞬间阻断脚本。
```html
<head>
    <style>
        /* 避免 WebView 生成瞬间的白底 */
        body { background-color: #1e1e1e; margin: 0; overflow: hidden; }
    </style>
</head>
<body>
    <div id="app-skeleton">
      <script>
        // 只要当前是在加载独立子窗口，瞬间消灭主界面沉重的加载动画
        if (window.location.search.includes('window=')) {
          document.getElementById('app-skeleton').style.display = 'none';
        }
      </script>
      <!-- ... -->
    </div>
</body>
```

---

## 4. 路由隔离与跳帧阻断功能 (React Entry)

**修改 `src/renderer/src/main.tsx`**：
识别 URL 参数作为路由机制。如果是子窗口，绕过主容器的 3D 加载延迟机制。

```tsx
const searchParams = new URLSearchParams(window.location.search);
const targetWindow = searchParams.get('window');

let RootComponent = <App />;

// 路由拦截：如果是独立窗口，只渲染他自己的纯净组件
if (targetWindow === 'modelOptimize') {
    RootComponent = (
        <React.Suspense fallback={null}>
            <ModelOptimizeModal
                visible={true}
                onClose={() => getCurrentWindow().hide()} // 关闭时调用 hide
                modelData={null}
                isStandalone={true} // 告诉组件进入脱壳模式
            />
        </React.Suspense>
    );
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(RootComponent);

if (targetWindow) {
    // 独立子窗口：由 WindowManager 控制显示，在此处只需清理 DOM 骨架
    const skeleton = document.getElementById('app-skeleton');
    if (skeleton) skeleton.remove();
} else {
    // 主引擎：为了遮掩 3D 启动时的卡顿，保留 requestAnimationFrame 的延迟显示缓冲
    requestAnimationFrame(() => {
        const skeleton = document.getElementById('app-skeleton');
        if (skeleton) skeleton.remove();
        getCurrentWindow().show().catch(() => {});
    });
}
```

---

## 5. 通信桥梁：Master-Slave RPC 架构

独立原生窗口最大的痛点是 **上下文隔离**。子窗口没有全局 Store，也拿不到庞大的 3D 节点，必须通过 IPC 进行轻量级状态同步。

**使用 `src/hooks/useRpc.ts`（已实现并处理了 React 并发卸载异常，可直接使用）核心逻辑简介**：

*   主界面组件使用 `useRpcServer` 负责下发状态。
*   子窗口组件使用 `useRpcClient` 接收状态，并发送操作指令（Command）。

---

## 6. 旧业务弹窗如何进行代码剥离 (以 ModelOptimize 为例)

任何一个即将被原生化的现存组件 `<SomeModal>`，都需要利用 `isStandalone` 属性进行彻底的“安保降级（脱壳）”。

### 6.1 UI 层面的脱壳处理
如果被判定是独立窗口，**绝对不能再返回 `<Modal>` 标签**，必须返回一个沾满屏幕 `width: 100vw, height: 100vh` 的纯净 `flex` 容器。

```tsx
// 你的纯净版组件内容
const innerContent = (<div>...各种 Slider, Checkbox 控制面板...</div>);

if (isStandalone) {
    return (
        <div style={{ width: '100vw', height: '100vh', backgroundColor: '#1e1e1e', display: 'flex', flexDirection: 'column' }}>
            {/* 定制原生操作系统的暗黑标题栏 */}
            <div style={{ height: '32px', backgroundColor: '#222', display: 'flex', alignItems: 'center', padding: '0 16px' }}>
                
                {/* 使用 flex 占满剩余空闲区域，并挂上原生系统拖拽热区标记 */}
                <div data-tauri-drag-region style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
                     <span data-tauri-drag-region style={{ color: '#e0e0e0' }}>模型优化</span>
                </div>
                
                {/* 必须独立在拖拽去外，否则系统会吞没 onClick 事件 */}
                <CloseOutlined onClick={onClose} style={{ color: '#888', cursor: 'pointer' }} />
            </div>
            
            {/* 内容区 */}
            <div style={{ padding: '12px 16px', flex: 1, overflowY: 'auto' }}>
                {innerContent}
            </div>
        </div>
    );
}

// 兼容旧模式：如果是嵌套调用，则正常套入 Antd Modal
return (
    <Modal open={visible} onCancel={onClose} modalRender={(modal) => <Draggable>{modal}</Draggable>}>
        {innerContent}
    </Modal>
);
```

### 6.2 状态与方法的代理
利用 RPC Client 接管曾经通过 Props 传入的函数与状态。

```tsx
// 之前通过 localstate 计算或获取的属性，全面使用 rpcState 接管
const { state: rpcState, emitCommand } = useRpcClient<MyState>('modelOptimize', { faces: 0 });

const handleExecuteClick = () => {
    if (isStandalone) {
        // 向主进程发送 RPC 执行指令
        emitCommand('EXECUTE_SOMETHING', { param: 1 });
    } else {
        // 原始调用方式
    }
}
```

---

## 7. 主界面装配清单 (MainLayout.tsx)

最后一步，是在主程序中统揽全局。

**1. 设定缓存命令接收器**（由于重新渲染频繁，回调函数必须 `useCallback` 避免导致 IPC 信道异常）：
```tsx
const handleMyCommand = useCallback((command: string, payload: any) => {
    // 处理指令
}, [dependencies]);

const { broadcastSync } = useRpcServer('modelOptimize', () => getMyState(), handleMyCommand);
```

**2. 触发后台池化预加载**（只在软件开启时执行一次）：
```tsx
useEffect(() => {
    windowManager.preloadToolWindow('modelOptimize', '模型优化窗口标题', 320, 380).catch(console.error);
}, []);
```

**3. 将打开操作替换为系统层接口**：
把原来修改局部 state 导致 `showXXXModal = true` 的逻辑，删掉或替换为：
```tsx
windowManager.openToolWindow('modelOptimize', '模型优化', 320, 380);
```

至此，一个完整的完美无缝 0 延迟原生窗口就迁移完成了！后续其他所有弹窗（如材质编辑器、贴图浏览器等）均可按照这 7 步进行机械式安全迁移。

---

## 8. 疑难杂症与深度踩坑记录 (Troubleshooting & Pitfalls)

在迁移开发过程中，尤其在构建 `useRpcClient` 和 `useRpcServer` 时，我们遭遇了多个极其隐蔽的 React 与 Tauri 跨进程系统级 Bug。以下记录将作为下个 AI 接手时的避坑指南。

### 坑一：React Hook 闭包导致的 Tauri 监听器无尽重启 (Listener Churn)
- **病症**：当我们把带有应用依赖函数（如 `handleCameraCommand`）直接传入 `useRpcServer` 时，每次主界面的任意重绘（即便只是鼠标移动），都会导致引用的函数对象地址变化。这引发了内层 `useEffect` 循环，导致 `tauri.listen` 监听器每秒钟被销毁然后异步重建！正好卡断了子窗口发送的 RPC 指令。
- **解法**：在 `useRpcServer` 内使用 `useRef` 保存传入的函数指针，彻底断绝因上层组件渲染导致的监听器重启。

### 坑二：多进程挂载竞态条件 (The Boot-up Race Condition)
- **病症**：独立工具窗口被 `WindowManager.preloadToolWindow` 并发预先启动（尽管是隐藏状态的），子窗口发出的首个同步状态事件 `rpc-req-xxx`，总是先于主窗口挂载完 `rpc-sync` Server 监听器！请求直接打空，子窗口数据永远为空板。
- **解法 (Handshake Polling)**：在 `useRpcClient` 中加入握手轮询机制，当发出 `rpc-req` 尚未收到答复 (`hasReceivedData === false`) 时，使用 `setInterval(..., 500)` 每半秒发一次指令，直到主进程成功回推首批数据。

### 坑三：Zustand 缺乏 prevState 导致的致命渲染奔溃 (Fatal Crash)
- **病症**：起初为了使得主界面在载入新模型的一瞬间自动广播最新数据给全部子窗口，我们在 `MainLayout` 中使用了底层订阅：
  `useModelStore.subscribe((state, prevState) => { ... })`
  然而这导致了启动 100% 报错卡死（TypeError）！因为如果不显式配置 Zustand 的 `subscribeWithSelector` 中间件，默认原生 API **是不传入第二个 prevState 参数的**（它为 undefined）。
- **解法**：采用原生词法闭包，在 `useEffect` 层级维护外部变量 `let prevNodes = state.nodes` 进行手动对比检测以触发推送。

---

## 9. 当前遗留的最大悬案 (Unresolved Problem) - 望后来者承续

经过全套修复，主代码运行不再崩溃，模型优化(`modelOptimize`)的独立窗口也能正确计算返回面数。
并且我们已经在 `useRpc.ts` 中植入了 `debugLog`，可以直接在 Rust 终端看到跨进程消息。

但是，**“相机管理器 (`cameraManager`)”即使在模型载入后，依然抓取不到任何数据（持续空白，列表无内容）。**

### 给下一任 AI 的排障提示 (Diagnostic Hints)

1. **Zustand `state.nodes` 数组引用突变问题**：
   在 `MainLayout.tsx` 的监听中检测依赖于 `state.nodes !== prevNodes`：
   如果载入新模型时，底层 `modelStore.ts` `parseMDX` 读取文件并组装 `nodes` 时，如果不小心使用了 **Mutate (原位置修改数组，如 `.push()`)**，这将导致新旧数组的物理指针 (`===`) 相等！如果 Zustand 检测不到引用变更，哪怕模型里有 10 个相机，外层判定语句也认定无变化，永远推不出 `broadcastSync` 广播。
   **行动建议：** 立刻去查阅 `src/renderer/src/store/modelStore.ts` 里对 `nodes` 的处理方式，确保加载文件后返回的是一个全新的扩展运算符 `[...newArray]` 构建的对象引用。
   
2. **事件路由名是否一致**：
   复查 `MainLayout.tsx` 和 `CameraManagerModal.tsx` 里传递的值 `rpc-req-cameraManager`, `rpc-sync-cameraManager` 是否百分之一百精确匹配。

3. **数据层映射异常**：
   主程序里 `state.nodes.filter(n => n.type === 5)` 的分类方式在现在的 war3-model 库中是否仍然有效？相机到底还是不是 `type === 5`？

4. **复现路径**：
   启动 `npm run dev`，读取一个自带相机的 .mdx 模型，检查终端是否打印了 `[RPC Server][cameraManager] Broadcasting state...`。如果没有，说明 Zustand 监听根本没触发。

彻底解决 CameraManager 同步问题后，你就可以依据本指南平移剩下的数十个模态框了，祝你一通百通！
