# 模型多边形优化技术方案说明

本文档描述当前项目中的多边形优化（顶点焊接 + 边折叠减面）实现细节，包含调用链、算法流程、约束策略、参数语义、代码位置与工程注意事项。

## 1. 入口与调用链

### 1.1 UI 触发
- 文件：`src/renderer/src/components/modals/ModelOptimizeModal.tsx`
- 关键位置：
  - `removeRedundantVertices`、`decimateModel`、`decimateRatio` 状态：`:19`、`:20`、`:21`
  - 发送多边形优化命令：`emitCommand('EXECUTE_POLYGON_OPT', payload)`：`:87`

### 1.2 主流程调用
- 文件：`src/renderer/src/components/MainLayout.tsx`
- 关键位置：
  - 命令分发：`if (command === 'EXECUTE_POLYGON_OPT')`：`:1740`
  - 调用优化入口：`optimizeModelPolygons(workingCopy, ...)`：`:1741`
  - 参数注入：`:1742` ~ `:1744`
  - 优化结果统计与提示：`:1764`

### 1.3 算法入口
- 文件：`src/renderer/src/utils/modelOptimization.ts`
- 函数：`optimizeModelPolygons`：`:1901`
- 默认参数：`DEFAULT_POLYGON_OPTIONS`：`:57`
  - `removeRedundantVertices: true`
  - `decimateModel: true`
  - `decimateRatio: 75`
  - `positionTolerance: 1e-4`
  - `uvTolerance: 1e-4`
  - `normalDotThreshold: 0.97`

## 2. 总体算法架构

当前多边形优化是分 geoset 执行的两阶段流水线：

1. 几何规范化与预打包  
- `packGeoset`：`:307`  
- 统一输入数据为 `PackedGeoset`（`vertices/normals/faces/tVertices/vertexGroup/groups`）。

2. 冗余顶点焊接（可选）  
- `weldRedundantVertices`：`:565`  
- 先做“安全焊接”去重，减少后续减面压力。

3. 自适应边折叠减面（可选）  
- `decimateByEdgeCollapse`：`:659`  
- 由 `runAdaptiveDecimation`（`optimizeSingleGeoset` 内）分档调用：`:810`

4. 组索引压缩与法线重建  
- `compactGroups`：`:470`  
- 变化后法线重算：`:965` ~ `:967`

5. 写回 geoset 与统计  
- 写回 `Vertices/Faces/VertexGroup/Groups/Normals/TVertices`：`:969` ~ `:977`
- 统计合并在 `optimizeModelPolygons`：`:1910` ~ `:1948`

## 3. 阶段一：冗余顶点焊接

### 3.1 安全保护模型
- 边界顶点检测：`buildBoundaryVertexSet`：`:346`
  - 统计边出现次数，出现 1 次的边视为边界边，其端点进入保护集合。
- 皮肤签名：`buildSkinSignatures`：`:369`
  - 以排序后的 bone 矩阵集合作为签名，允许“同骨集合不同组号”视作等价。
- UV/皮肤缝保护：`buildProtectedVertices`：`:432`
  - 位置量化分桶后，若同位点存在多 UV 或多皮肤签名，整桶加锁，避免焊接破坏缝线。

### 3.2 焊接键与合并
- 键构造：`buildKeyHash`：`:490`
  - 由位置、法线、UV、皮肤签名组合，受 `positionTolerance/uvTolerance` 影响。
- 执行焊接：`weldRedundantVertices`：`:565`
  - 对重复键进行 root 合并，位置/法线/UV 使用计数加权平均。
  - 用 `rebuildMesh` 重建索引并移除退化三角形：`:511`

### 3.3 产出
- 产出焊接后的几何与统计：
  - `collapsedEdges`（焊接减少顶点数估算）：`:654`
  - `degenerateFacesRemoved`（退化面剔除数）：`:652`

## 4. 阶段二：边折叠减面（Edge Collapse）

### 4.1 目标与预算
- 目标面数：
  - 比例目标：`ratioTargetFaceCount`：`:669`
  - 可传绝对目标：`absoluteTargetFaceCount`：`:663`、`:670`
- 折叠预算：
  - `collapseBudget = faceCount - targetFaceCount`：`:727`
  - 该策略优先逼近目标面数，不再使用保守半步预算。

### 4.2 候选边生成
- 去重边集合：`edgeSeen`：`:699`
- 候选过滤条件：
  - 保护顶点过滤：`:713`
  - 皮肤约束过滤：`:714`
  - UV 误差过滤（可关闭）：`:715`
  - 法线夹角过滤（可关闭）：`:716`
- 代价函数（升序）：
  - `cost = 位置距离² + 0.25 * UV距离²`：`:718`

### 4.3 折叠执行
- 并查集维护顶点代表：`:681` ~ `:697`
- 合并方式：
  - root 顶点按权重平均更新位置/法线/UV：`:744` ~ `:764`
- 重建网格并剔除退化面：
  - `rebuildMesh(...)`：`:775`

## 5. 皮肤约束与缝线约束策略

### 5.1 SkinConstraint
- 定义：`:297`
- 模式：
  - `strict`：仅允许同皮肤签名塌缩。
  - `overlap`：允许骨集合重叠度满足阈值（`minOverlap`）。
  - `off`：不限制皮肤。
- 判定函数：`canCollapseSkinPair`：`:408`
  - `overlap` 模式额外包含锚骨一致性保护（防止大幅绑定跳变）：`:425` ~ `:428`

### 5.2 CollapseConstraint
- 定义：`:302`
- 用途：
  - `checkUv` 控制是否启用 UV 误差过滤。
  - `checkNormal` 控制是否启用法线夹角过滤。
- 生效位置：
  - 候选边构建：`:715`、`:716`
  - 执行前复检：`:741`、`:742`

## 6. 五档自适应减面（从保守到激进）

位置：`runAdaptiveDecimation` 中 `profiles`：`:814` ~ `:874`

### 6.1 Profile 1（强保守）
- `lockBoundary=true`
- `protectUvSkinSeams=true`
- `skinConstraint=strict`
- `checkUv/checkNormal=true`
- `maxPasses=2`

### 6.2 Profile 2（保守放松）
- 边界仍锁，缝线仍保护
- UV 容差与法线阈值略放松
- `maxPasses=3`

### 6.3 Profile 3（中等激进）
- 不锁边界
- 缝线保护开启
- `skinConstraint=overlap(0.75)`
- `maxPasses=3`

### 6.4 Profile 4（激进）
- 不锁边界
- 缝线保护开启
- `skinConstraint=overlap(0.5)`
- `maxPasses=4`

### 6.5 Profile 5（最激进收敛档）
- 不锁边界
- 关闭缝线保护
- `skinConstraint=off`
- `checkUv=false`、`checkNormal=false`
- `maxPasses=10`
- 目标：在可用边存在时尽量逼近 `targetFaceCount`

## 7. 组与索引一致性处理

### 7.1 Group 索引重排
- `compactGroups`：`:470`
- 将未使用组清理并重映射 `VertexGroup`，确保导出结构紧凑。

### 7.2 Faces 索引类型选择
- `makeTypedFaceArray`：`:280`
- 若最大索引 `< 65536` 使用 `Uint16Array`，否则使用 `Uint32Array`。

## 8. 统计指标定义

结构定义：`PolygonOptimizationStats`：`:13`

- `geosetsProcessed`：处理的 geoset 数
- `verticesBefore/verticesAfter`：优化前后顶点数
- `facesBefore/facesAfter`：优化前后三角面数
- `degenerateFacesRemoved`：重建过程中剔除的退化面
- `collapsedEdges`：焊接与边折叠累计塌缩次数

汇总逻辑：`optimizeModelPolygons`：`:1910` ~ `:1934`

## 9. 复杂度与性能特征

- 焊接阶段：
  - 主要成本在顶点分桶与重建，近似 `O(V + F)`。
- 减面阶段：
  - 候选边构建近似 `O(F)`，排序 `O(E log E)`。
  - 多 profile 多 pass 叠加后，实际成本与模型拓扑约束强相关。
- 实际优化策略：
  - 先焊接再减面，可显著降低候选边规模，提高后续收敛效率。

## 10. 参数调优建议

### 10.1 压缩率优先
- 提高 `decimateRatio` 的“减面力度”意图（例如 50% 保留）。
- 适当提高 `uvTolerance`，降低 `normalDotThreshold`。
- 保留 `removeRedundantVertices=true`，先压重复顶点。

### 10.2 质量优先（避免破面/缝线）
- 降低 `uvTolerance`。
- 提高 `normalDotThreshold`（例如接近 0.95+）。
- 尽量避免进入 profile 5（最激进档）。

### 10.3 骨骼动画模型（skinned mesh）
- 优先使用 `strict` 或高重叠度 `overlap` 策略。
- 若必须高压缩，建议分动作检查关键姿态是否出现绑定漂移。

## 11. 已知边界与风险

- 最激进档会关闭 UV/法线/皮肤约束，可能带来：
  - 细节丢失
  - 缝线伪影
  - 蒙皮局部变形
- 当前代价函数以几何邻近优先，未引入屏幕空间误差（QEM/视点感知）权重。
- 对极端非流形拓扑，候选边数量和质量会波动。

## 12. 代码速查清单

- 参数定义：`modelOptimization.ts:4`
- 默认参数：`modelOptimization.ts:57`
- geoset 打包：`modelOptimization.ts:307`
- 边界检测：`modelOptimization.ts:346`
- 皮肤签名与约束：`modelOptimization.ts:369`、`:408`
- 缝线保护：`modelOptimization.ts:432`
- 顶点焊接：`modelOptimization.ts:565`
- 边折叠减面：`modelOptimization.ts:659`
- 自适应 profile：`modelOptimization.ts:814`
- 单 geoset 优化：`modelOptimization.ts:801`
- 全模型入口：`modelOptimization.ts:1901`
- UI 发起优化：`MainLayout.tsx:1741`

