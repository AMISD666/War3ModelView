# 模型关键帧优化算法说明

本文档说明当前项目的关键帧优化实现，重点覆盖：
- 算法流程
- 抗抖动机制
- 关键参数
- 代码位置（文件 + 行号）

## 1. 入口与调用链

### 1.1 UI 触发入口
- 文件：`src/renderer/src/components/modals/ModelOptimizeModal.tsx`
- 说明：模型优化窗口中“执行关键帧优化”按钮，发送 `EXECUTE_KEYFRAME_OPT` 指令。

### 1.2 主流程入口
- 文件：`src/renderer/src/components/MainLayout.tsx:1769`
- 函数调用：`optimizeModelKeyframes(workingCopy, { removeRedundantFrames, optimizeKeyframes })`
- 说明：
  - 先深拷贝模型，优化后回写 Zustand。
  - 推入历史栈（undo/redo）。
  - 输出统计信息（关键帧前后数量、轨道数量、耗时）。

### 1.3 算法入口函数
- 文件：`src/renderer/src/utils/modelOptimization.ts:1640`
- 函数：`optimizeModelKeyframes(sourceModel, options, onProgress)`
- 默认参数：`DEFAULT_KEYFRAME_OPTIONS`（同文件 `:66`）
  - `removeRedundantFrames: true`
  - `optimizeKeyframes: true`
  - `scalarTolerance: 3e-4`
  - `vectorTolerance: 1.2e-3`
  - `rotationToleranceDeg: 0.22`

## 2. 总体算法流程

对每个动画轨道（AnimVector）执行如下阶段：

1. 关键帧预处理  
- 位置：`normalizeAndSortKeys`（`modelOptimization.ts`）  
- 行为：过滤非法帧、按帧号排序、同帧去重（保留后者）。

2. 轨道类型识别  
- 离散轨道识别：`isDiscreteTrack`（`:992`）  
- 旋转轨道识别：`isRotationTrack`（`:1006`）  
- 说明：离散轨道（如可见性/贴图ID等）不走连续插值删减。

3. 旋转轨道连续性修正  
- 位置：`enforceQuaternionContinuity`（`:1236`）  
- 行为：四元数归一化 + 同半球对齐（dot<0 时翻转符号），避免跨长弧插值导致抖动。

4. 自适应误差阈值计算  
- 值误差阈值：`computeAdaptiveTolerance`（`:1255`）  
- 速度误差阈值：`computeVelocityTolerance`（`:1286`）  
- 旋转安全系数：`computeRotationSafetyFactor`（`:1357`）  
- 说明：动作越复杂、角速度变化越剧烈，阈值越收紧。

5. 冗余帧初筛（可选）  
- 位置：`optimizeAnimVector`（`:1449`，`removeRedundantFrames` 分支）  
- 行为：删除与前一帧几乎相同的帧，但保留序列边界帧与强制保留帧。

6. 主删减（RDP 分段简化 + 锚点保护）  
- 位置：`simplifySegmentRdp`（`:1384`）  
- 说明：
  - 锚点：首尾帧 + 强制帧（序列边界、极值点、旋转转折点）。
  - 分段递归保留误差最大的关键帧。
  - 评分同时考虑值误差、速度误差、采样误差。

7. 局部二次清理（最多 3 轮）  
- 位置：`canRemoveMiddleKey`（`:1176`） + `optimizeAnimVector` 后段  
- 行为：三点局部判断是否可删中间帧，进一步压缩。

8. 写回与统计  
- 位置：`optimizeAnimVector`（`:1449`）  
- 输出：`before/after/changed`，并累计到 `optimizeModelKeyframes` 统计中。

## 3. 抗抖动核心机制（当前实现重点）

### 3.1 旋转速度误差升级（标量 -> 向量）
- 相关函数：
  - `quaternionVelocityVector`（`:262`）
  - `velocityErrorBetween`（`:1024`）
- 关键点：
  - 以前只比较角速度大小，无法识别“转动方向突变”。
  - 现在比较三轴角速度向量差（max-abs），对抖动更敏感。

### 3.2 区间采样误差包络
- 函数：`sampleCollapsedIntervalErrors`（`:1068`）
- 用途：在尝试删除某中间帧时，不只检查该帧点误差，而是在整个区间做多点采样：
  - 值误差采样（多个分数位）
  - 速度误差采样（中心差分近似）
- 结果用于：
  - `canRemoveMiddleKey`（`:1176`）的最终放行判断
  - `simplifySegmentRdp`（`:1384`）的打分

### 3.3 旋转轨道更严格的放行阈值
- 位置：`canRemoveMiddleKey`（`:1193` ~ `:1194`）
- 策略：
  - 对旋转轨道施加更保守系数：
    - `safeValueTol = valueTolerance * 0.82`
    - `safeVelocityTol = velocityTolerance * 0.75`

### 3.4 旋转转折保护
- 函数：`collectRotationVelocityChangeFrames`（`:1334`）
- 机制：检测相邻区间角速度突变，转折帧加入强制保留集合，避免关键转向被删掉。

## 4. 误差模型与判定标准

### 4.1 值误差
- 普通轨道：`vectorMaxAbsDiff`（各维最大绝对误差）
- 旋转轨道：`quaternionAngleDeg`（角度误差，单位度）
- 相关函数：`valueErrorBetween`（`:1017`）、`interpolationError`（`:1133`）

### 4.2 速度误差
- 普通轨道：各维速度差最大值
- 旋转轨道：角速度向量差最大值
- 相关函数：`velocityErrorBetween`（`:1024`）、`localCollapseVelocityError`（`:1152`）

### 4.3 删除中间帧判定
- 函数：`canRemoveMiddleKey`（`:1176`）
- 必须同时满足：
  - 三点插值值误差 <= 阈值
  - 局部速度误差 <= 阈值
  - 区间采样值误差 <= 安全阈值
  - 区间采样速度误差 <= 安全阈值

## 5. 序列边界与安全帧保护

- 序列边界帧收集：`collectSequenceBoundaryFrames`（`:1574`）
- 所有序列起止帧（以及 0 帧）默认保护，不参与危险删减。
- 在 `optimizeModelKeyframes` 中作为 `preserveFrames` 传入每条轨道。

## 6. 代码定位清单（速查）

- 参数定义：`modelOptimization.ts:23`
- 默认参数：`modelOptimization.ts:66`
- 旋转角速度向量：`modelOptimization.ts:262`
- 轨道识别：`modelOptimization.ts:992`, `:1006`
- 区间采样误差：`modelOptimization.ts:1068`
- 局部删帧判定：`modelOptimization.ts:1176`
- 四元数连续性：`modelOptimization.ts:1236`
- 自适应阈值：`modelOptimization.ts:1255`, `:1286`
- 旋转安全系数：`modelOptimization.ts:1357`
- RDP 简化：`modelOptimization.ts:1384`
- 单轨优化入口：`modelOptimization.ts:1449`
- 全模型优化入口：`modelOptimization.ts:1640`
- UI 调用：`MainLayout.tsx:1769`

## 7. 当前行为特征与边界

- 优点：
  - 对旋转抖动更敏感，删减后动作稳定性显著提升。
  - 在复杂动作段自动收紧阈值，减少误删关键转折。
- 边界：
  - 对非线性插值轨道（LineType > 1）当前策略较保守。
  - 极端高频动作仍可能需要更低 `rotationToleranceDeg` 才能完全避免视觉波动。

## 8. 调参建议（实战）

- 若仍出现轻微抖动：
  - 优先降低 `rotationToleranceDeg`（如 0.22 -> 0.16）
  - 其次降低 `vectorTolerance`
- 若压缩率不够：
  - 先提高 `rotationToleranceDeg`（如 0.22 -> 0.28），观察关键动作段是否可接受。

