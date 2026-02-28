# 模型关键帧优化算法升级方案：SPOS+ (Shortest-Path Optimal Subset with Perceptual Anchoring)

## 1. 方案背景
当前的算法采用的是 **RDP (Douglas-Peucker)** 变体结合局部删减逻辑。虽然在处理旋转抖动上已有改进，但仍存在以下局限：
- **局部最优非全局最优**：递归分段（RDP）或局部迭代删减（Greedy）无法保证在满足误差阈值的前提下，保留最少数量的关键帧。
- **缺乏动力学感知**：对动作的“动量（Momentum）”和“曲率（Curvature）”感知不足，容易在动作转折处产生微小的“动作变形”或“语义丢失”。

## 2. 超思维分析 (Ultrathink Reasoning)
### 2.1 核心数学模型：最短路径问题
我们要解决的是一个在 $N$ 个原始帧中选择子集 $S \subseteq \{0, \dots, N-1\}$，使得：
- $\forall t \in [0, \text{End}], \text{Dist}(\text{Interpolate}_S(t), \text{Original}(t)) < \epsilon$
- $|S|$ 最小化（即保留帧数最少）。

这在数学上可以完全转化为 **DAG（有向无环图）中的最短路径问题**：
- **节点**：每一个原始关键帧。
- **边 $(i, j)$**：如果直接从第 $i$ 帧插值到第 $j$ 帧，其中间所有的原始帧 $k \in (i, j)$ 的误差都小于阈值，则建立一条边。
- **权重**：所有边权重为 1。
- **目标**：求从起点帧到终点帧的最短路径。

### 2.2 “零变形”保护机制：感知锚点 (Perceptual Anchors)
为了防止动作变形，不能仅仅依赖“点对点误差”，必须引入以下保护：
- **曲率自适应阈值 (Curvature-Aware Envelope)**：在加速度变化剧烈的区间（如收刀、受击反馈），动态收紧 $\epsilon$。
- **转折点保护 (Inflection Protection)**：二阶导数符号改变（拐点）的帧必须作为候选必保留帧（Soft Anchors），确保动作的“弧度”不被抹平。
- **动量保持 (Momentum Safety)**：确保简化后的段首尾速度向量差不超出感知范围，防止动作产生“迟滞感”。

---

## 3. 拟实施的方案

### 3.1 边合法性校验器 (Edge Validator)
- 多维误差检查：除了 `Value Error` 和 `Velocity Error`，加入 `Tangent Deviation` 检查。
- **曲率惩罚因子**：$\epsilon_{effective} = \frac{\epsilon_{base}}{1 + \text{Curvature} \cdot \alpha}$。

### 3.2 动态规划求解器 (Optimal Subset Solver)
- 使用滑动窗口优化的边构建逻辑，将 $O(n^3)$ 复杂度显著降低。
- $dist[j] = \min_{i \in \text{ValidPredecessors}(j)} (dist[i] + 1)$。

### 3.3 非线性插值支持
- 针对 Hermite 或 Bezier 轨道，在校验边合法性时使用对应的插值公式，而非简单的线性插值。

---

## 4. 预期效果
- **压缩率提升**：在相同误差参数下，SPOS 应比现有 RDP 提升 10%~25% 的压缩比。
- **零变形保证**：通过“感知锚点”技术，确保关键动作转折点被 100% 保留。
- **无抖动渲染**：曲率感知包络线从根本上消除了过度压缩带来的高频微抖动。
