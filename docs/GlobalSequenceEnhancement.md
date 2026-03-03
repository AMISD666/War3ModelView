# 全局序列编辑增强功能文档

本文档介绍了对 War3ModelView 全局序列编辑体验进行的增强功能。

## 主要功能

### 1. 新建全局序列按钮
在所有全局序列下拉框（`Select`）的最顶部，新增了一个 **"+ 新建全局序列"** 按钮。
- **操作**: 点击该按钮将自动在模型中新增一个默认时长（1000ms）的全局序列，并自动将其选中。
- **覆盖范围**: 该功能已集成到 `KeyframeEditor` (关键帧编辑器)、`EventObjectDialog` (事件对象面板) 和 `TextureAnimGizmoPanel` (贴图动画控制器) 中。

### 2. 双击快速修改时长
用户现在可以通过双击全局序列下拉框来直接修改当前选中序列的持续时间。
- **操作**: 
    1. 在下拉框中选择一个全局序列。
    2. 双击该下拉框。
    3. 下拉框将切换为数字输入框（`InputNumber`）。
    4. 输入新的时长并按回车或使其失去焦点。
- **同步**: 修改后的时长会实时同步到模型数据，并在所有窗口（包括主窗口和独立窗口）中保持一致。

## 技术实现细节

### `GlobalSequenceSelect` 组件
我们创建了一个通用的 `GlobalSequenceSelect` 组件，封装了上述逻辑。
- **文件路径**: `src/renderer/src/components/common/GlobalSequenceSelect.tsx`
- **状态管理**: 
    - 使用 `useModelStore` (Zustand) 在主窗口中同步数据。
    - 使用 `useRpcClient` 在独立窗口通过 RPC 通信同步数据。
- **UI 交互**:
    - 利用 Ant Design 的 `dropdownRender` 插入新建按钮。
    - 通过内部 `isEditing` 状态实现下拉框与输入框的无缝切换。

## 修改的文件列表

1. `src/renderer/src/components/common/GlobalSequenceSelect.tsx` [NEW]
2. `src/renderer/src/components/editors/KeyframeEditor.tsx`
3. `src/renderer/src/components/node/EventObjectDialog.tsx`
4. `src/renderer/src/components/animation/TextureAnimGizmoPanel.tsx`

## 验证与测试
- [x] 多窗口同步测试：在独立的关键帧编辑器中修改时长，主窗口数据同步更新。
- [x] 稳定性测试：频繁添加和修改全局序列，确保不会导致渲染崩溃或数据丢失。
- [x] 交互测试：验证双击触发输入框的灵敏度及输入后的保存行为。
