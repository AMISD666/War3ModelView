# War3ModelView Project Status & Handoff

## 1. 当前进度 (Current Progress)

### 已完成功能 (Completed)
1.  **相机状态保持 (Camera State Persistence)**:
    *   实现了 `keepCameraOnLoad` 设置，允许在切换模型时保持相机位置、角度和缩放。
    *   在 `Viewer.tsx` 中增加了手动 "适应视图" (Fit to View) 功能及快捷键 `F`。
    *   设置持久化存储于 `RendererStore`。

2.  **模型一键复制 (Model Copy Feature)**:
    *   **后端 (Rust)**: 实现了 `copy_model_with_textures` 命令，使用 `clipboard-win` 库操作系统剪贴板。
    *   **前端 (React)**: 在 `ModelCard` 中增加了复制按钮，并支持 `Ctrl+C` 快捷键。
    *   **文件结构保持 (Folder Structure)**: 采用临时目录方案。复制时先将模型和检测到的贴图拷贝到临时文件夹（按原始相对路径排列），然后将临时文件列表整体写入剪贴板。粘贴时可保持 `war3mapimported\` 等子目录结构。
    *   **多路径贴图搜索**: 修复了贴图找不到的问题。现在会递归搜索模型所在目录、父目录、祖父目录（最多3层），并尝试多种后缀名 (`.blp`, `.tgas`, `.png`, `.dds`)。

### 待处理/进行中 (In Progress / Pending)
1.  **批量贴图路径修改**: UI 按钮已就绪，但 `handleEditTexture` 逻辑尚未实现完整批量修改功能。
2.  **从 MPQ 提取贴图**: 如果本地路径完全找不到贴图，目前的复制功能会提示 "0个贴图"。未来可以考虑自动从绑定的 MPQ 文件中提取缺失贴图。
3.  **内存管理优化**: 批量预览模式下，WebView2 和 GPU 内存占用较高的问题仍有优化空间（已优化过一轮 LRU 缓存）。

## 2. 核心架构说明 (Architecture Note)
*   **渲染器**: 位于 `war3-model-4.0.0` 目录，是纯 WebGL 实现的渲染引擎。
*   **前端布局**: 使用 Vite + React + Ant Design。
*   **后端能力**: 使用 Tauri，大部分文件系统和系统交互逻辑位于 `src-tauri/src/main.rs`。
*   **剪贴板逻辑**: 使用 `CF_HDROP` 格式，必须通过 Rust 调用 Windows API。

## 3. 下一步计划 (Next Steps)
1.  **验证贴图复制**: 让用户在最新的 "3层父目录搜索" 逻辑下验证是否能成功复制 `war3mapimported` 目录下的贴图。
2.  **实现文件夹整体导出/复制**: 当前是单模型复制。用户可能需要 "导出所有搜索到的文件"。
3.  **完善状态栏/通知**: 目前使用 `message.success` 提示复制结果，可以增加更详细的文件列表预览。

## 4. 经验总结 (Lessons Learned)
*   **Windows 剪贴板限制**: 直接通过文件路径列表写入剪贴板不会自动创建文件夹。必须实现在临时目录中构建好结构后，将临时文件路径送入剪贴板，Windows 资源管理器在粘贴时才会按目录结构放置。
*   **贴图解析**: 魔兽3模型的贴图路径存储在 `TEXS` 块。如果是从地图导出的模型，路径通常是 `war3mapimported\xxx.blp`，而本地文件系统可能把贴图放在模型的上一级 `resource` 文件夹中。

---
*更新时间：2026-01-13*
