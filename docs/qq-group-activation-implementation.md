# QQ 群成员验证 + 激活码方案迁移说明

## 1. 方案概览

当前项目使用的是一套混合激活方案，分成两条通路：

1. 激活码授权
   后端使用 `Ed25519` 公钥验证激活码签名，激活码和机器码绑定，可支持永久授权或时限授权，也可区分基础版/高级版。
2. QQ 群成员验证
   后端打开一个内置 `WebView` 到 QQ 群成员页，通过注入脚本检测目标群号是否出现在页面中；验证成功后只在本地记录一次“群成员已验证”时间，并给基础版权限，180 天后要求复验。

当前实现是“本地校验优先”，没有在线授权服务参与运行时校验。真正的安全边界在于：

- 激活码签名私钥不在客户端
- 客户端只内置公钥
- 功能权限最终以后端返回的激活状态为准

## 2. 当前项目中的实现位置

核心文件：

- `src-tauri/src/activation.rs`
- `src-tauri/src/main.rs`
- `src/renderer/src/App.tsx`
- `src/renderer/src/components/modals/ActivationModal.tsx`
- `src/renderer/src/utils/featureGate.ts`
- `src/renderer/src/components/MainLayout.tsx`

当前关键常量在 `src-tauri/src/activation.rs`：

- `REG_PATH = "SOFTWARE\\GGWar3ModelEditor"`
- `QQ_TARGET_GROUP_ID = "168886891"`
- `QQ_REVERIFY_SECONDS = 180 * 24 * 60 * 60`
- `PUBLIC_KEY_B64 = "..."`，用于验签
- `iss = "War3ModelEditor"`，用于校验激活码发行者

## 3. 当前完整调用链

### 3.1 启动检查

1. `src/renderer/src/App.tsx` 启动后调用 Tauri 命令 `get_activation_status`。
2. 如果返回 `is_activated = false`，就显示 `ActivationModal`。
3. 如果已激活，直接进入主界面。

### 3.2 后端状态判定顺序

`src-tauri/src/activation.rs` 的 `get_activation_status()` 按以下顺序判定：

1. 先检查是否存在系统时间回拨
2. 如果本地保存了激活码，则优先验证激活码
3. 如果激活码无效或不存在，再检查 QQ 群验证时间是否仍在有效期内
4. 都不满足则返回未激活

这个优先级意味着：

- 高级版激活码会覆盖 QQ 基础版状态
- QQ 群验证只是兜底的基础版入口

### 3.3 机器码生成

`get_machine_id()` 的实现逻辑：

1. 先从注册表读取缓存的 `WmiUuidCache`
2. 没有缓存时执行 `wmic csproduct get uuid`
3. 如果拿到了主板 UUID，则写回注册表缓存
4. 如果 WMI 失败，则生成一个随机 UUID 并保存在注册表 `MachineId`

这样做的目的：

- 首次启动尽量拿稳定硬件标识
- 后续启动不重复调用慢速的 `wmic`
- 极端情况下仍有可用的本地机器码

### 3.4 激活码结构

激活码本质上是：

`base64(payload_json) + "." + base64(signature)`

其中 `payload_json` 对应结构：

```json
{
  "mid": "机器码",
  "typ": "PERM 或 TIME",
  "exp": 0,
  "ver": 1,
  "iss": "War3ModelEditor",
  "lvl": 1
}
```

字段含义：

- `mid`: 机器码，必须和客户端当前机器码一致
- `typ`: `PERM` 永久授权，`TIME` 时限授权
- `exp`: Unix 时间戳，`0` 表示永久
- `ver`: 结构版本
- `iss`: 发行者标识，用于防止不同项目之间串码
- `lvl`: 授权等级，`1` 基础版，`2` 高级版

### 3.5 激活码校验

`verify_license()` 的校验步骤：

1. 拆分 `payload` 和 `signature`
2. Base64 解码
3. 用内置 `Ed25519` 公钥验证签名
4. 反序列化 payload JSON
5. 校验 `mid` 是否等于当前机器码
6. 校验 `iss` 是否等于项目约定值
7. 如果是 `TIME`，再校验是否过期

校验通过后，`activate_software()` 会：

1. 把激活码写入注册表 `License`
2. 写入 `LastCheckTime`
3. 返回当前授权状态给前端

### 3.6 QQ 群成员验证

后端命令定义在 `src-tauri/src/main.rs`：

- `open_qq_verification_window`
- `check_qq_verification_window_status`
- `close_qq_verification_window`

实现流程：

1. 前端点击“打开 QQ 群验证”
2. 后端创建名为 `qq_verification` 的 WebView 窗口
3. WebView 打开 QQ 群成员页登录地址：
   `https://xui.ptlogin2.qq.com/cgi-bin/xlogin?...&s_url=https%3A%2F%2Fqun.qq.com%2Fmember.html%23`
4. 后端向该页面注入脚本，每秒检查页面 HTML 中是否包含目标群号
5. 如果包含，则把页面 hash 改成 `#verified_ok_<群号>`
6. 前端每 2 秒调用一次 `check_qq_verification_window_status`
7. 后端读取 WebView 当前 URL，如果发现带有这个 hash，则认为验证成功
8. 后端调用 `save_qq_verification_now()`，把当前时间写入注册表 `QQVerif`
9. 验证窗口销毁，前端刷新激活状态

QQ 验证的本地授权特点：

- 不生成激活码
- 不绑定机器码
- 只记录“本机在某时刻完成过群成员验证”
- 到期时间 = `QQVerif + 180 天`
- 只授予 `level = 1`

### 3.7 本地持久化

当前项目把这些内容写在 Windows 注册表：

- `License`: 保存激活码原文
- `MachineId`: WMI 失败时的兜底机器码
- `WmiUuidCache`: 缓存主板 UUID
- `LastCheckTime`: 上次校验时间，用于检测时间回拨
- `QQVerif`: QQ 群验证完成时间

### 3.8 功能分级

前端公共工具在 `src/renderer/src/utils/featureGate.ts`：

- `getActivationStatus()`
- `hasLicenseLevel(requiredLevel)`
- `isBasicUser()`
- `isProUser()`
- `requireBasicFeature(featureName)`
- `requireProFeature(featureName)`

设计意图是：

- `level = 0` 未激活
- `level = 1` 基础版，可由 QQ 群验证或基础版激活码获得
- `level = 2` 高级版，只能由高级激活码获得

## 4. 迁移到另一个项目时的详细实施步骤

下面按“另一个 Tauri + React 项目”来写。如果你的另一个项目也是 Tauri，这套结构可以基本原样搬过去。

### 步骤 1：复制后端激活模块

在新项目里新增一个类似 `src-tauri/src/activation.rs` 的模块，保留以下职责：

- 机器码获取
- 注册表读写
- 激活码验签
- QQ 验证时间保存与过期判断
- 激活状态统一输出

建议直接保留这两个结构：

- `LicensePayload`
- `ActivationStatus`

这样前后端接口最稳定。

### 步骤 2：替换成新项目自己的常量

这一项必须做，不能照搬当前值。

必须替换：

1. `REG_PATH`
   改成你另一个项目自己的注册表路径，避免和当前软件互相污染。
2. `PUBLIC_KEY_B64`
   必须换成新项目自己的 Ed25519 公钥。
3. `iss`
   例如改成 `MyOtherApp`，防止两个项目的激活码串用。
4. `QQ_TARGET_GROUP_ID`
   如果另一个项目使用不同 QQ 群，改成新群号。
5. UI 文案
   包括弹窗标题、软件名、说明文字。

不建议直接复用当前项目的公私钥体系。正确做法是为另一个项目重新生成一对密钥。

### 步骤 3：准备新项目自己的发码端

客户端只有公钥，所以你还需要单独准备一个“发码脚本”或“后台服务”。

这个发码端要做的事只有一件：

1. 生成 payload JSON
2. 用私钥对 payload 原始字节签名
3. 输出 `base64(payload).base64(signature)`

推荐规则：

- 基础版激活码：`lvl = 1`
- 高级版激活码：`lvl = 2`
- 永久授权：`typ = "PERM"` 且 `exp = 0`
- 时限授权：`typ = "TIME"` 且 `exp = 到期时间戳`

建议不要把私钥放到项目仓库、客户端源码、更新包或前端环境变量中。

### 步骤 4：在 Tauri 主程序注册命令

把下面几个命令挂到 `src-tauri/src/main.rs`：

- `get_machine_id`
- `get_activation_status`
- `activate_software`
- `open_qq_verification_window`
- `check_qq_verification_window_status`
- `close_qq_verification_window`

然后在 `invoke_handler` 里注册它们。

如果你不打算保留 QQ 群验证，只保留前三个即可。

### 步骤 5：复制 QQ WebView 验证逻辑

如果另一个项目也要保留“群成员验证激活基础版”，则继续迁移这一段。

核心保持不变：

1. 打开 QQ 登录后跳转到群成员页
2. 注入脚本定时扫描页面 HTML
3. 检测到目标群号后修改 URL hash
4. 宿主进程轮询窗口 URL
5. 命中 hash 后记录本地验证时间

你在新项目里至少要保留这些细节：

- 固定窗口 label，避免重复打开时冲突
- 打开前先销毁旧窗口
- 给 WebView 设置 initialization script
- 轮询超时和用户取消逻辑
- 验证成功后立即销毁窗口

注意风险：

- 这套方案依赖 QQ 页面结构和内容中仍然能看到目标群号
- 如果 QQ 页面结构未来变化，这段检测逻辑会失效
- 所以它适合作为“低成本基础版入口”，不适合作为唯一高安全授权机制

### 步骤 6：复制前端激活弹窗

在新项目里新增一个类似 `ActivationModal.tsx` 的组件，保留三块能力：

1. 展示机器码
2. 输入激活码并调用 `activate_software`
3. 打开 QQ 验证窗口并轮询结果

当前项目前端行为是：

- 打开弹窗时加载机器码
- 点击 QQ 验证后开始每 2 秒轮询
- 超时时间为 2 分钟
- 成功后调用 `onActivated()`

新项目照抄这套时，只需要改软件名、群号和文案。

### 步骤 7：加入启动拦截

在应用入口组件中增加：

1. 首屏启动后调用 `get_activation_status`
2. 如果未激活，显示激活弹窗
3. 激活成功后关闭弹窗并进入主功能

当前项目这一步在 `src/renderer/src/App.tsx` 完成。

### 步骤 8：接入功能权限控制

只弹窗不够，你还要在功能入口处加分级判断。

建议保留 `featureGate.ts` 这类工具层，然后在功能按钮、菜单命令、关键操作入口前调用：

- 基础功能用 `requireBasicFeature`
- 高级功能用 `requireProFeature`

这样另一个项目就能复用同一套分级模型：

- 未激活：全部受限
- QQ 群验证 / 基础版码：开放基础功能
- 高级版码：开放全部功能

### 步骤 9：保留“关于”或“授权中心”

当前项目除了启动弹窗，还有一个二次入口用于：

- 查看授权状态
- 查看到期/复验日期
- 输入新激活码升级

新项目也建议保留一个固定入口，否则用户后续升级高级版不方便。

### 步骤 10：测试完整链路

迁移完成后至少验证下面这些场景：

1. 首次启动，未激活时是否出现弹窗
2. QQ 群验证成功后是否得到 `level = 1`
3. QQ 群验证后重启软件，是否仍然有效
4. 超过 180 天后是否重新要求验证
5. 基础版激活码是否得到 `level = 1`
6. 高级版激活码是否得到 `level = 2`
7. 时限激活码过期后是否失效
8. 输入别的机器生成的激活码是否被拒绝
9. 把系统时间往回调后是否触发时间异常
10. 高级版激活码是否会覆盖 QQ 基础版状态

## 5. 推荐的迁移策略

如果你准备把这套方案搬到另一个项目，我建议按下面顺序做，而不是一次性全部复制。

第一阶段：

- 先迁移 `activation.rs`
- 先只接激活码校验
- 跑通 `get_machine_id / activate_software / get_activation_status`

第二阶段：

- 再迁移启动弹窗
- 再接 `featureGate.ts`
- 让基础功能和高级功能真正分级

第三阶段：

- 最后再接 QQ 群验证
- 因为这一部分最依赖外部页面，稳定性最差

这样排的原因是：

- 激活码链路是核心授权链路，稳定且可控
- QQ 群验证只是“低门槛基础版入口”，不是最关键部分

## 6. 安全和维护注意事项

1. 新项目必须使用新密钥对
   不要和当前项目共用私钥或公钥体系。
2. 新项目必须使用新的 `iss`
   否则不同项目可能互相接受对方激活码。
3. 新项目必须使用新的注册表路径
   否则两个软件会共享授权状态。
4. 不要只在前端做权限判断
   前端提示可以有，但最终状态应由后端统一返回。
5. QQ 验证逻辑要预期失效
   因为它依赖第三方页面结构，后续可能需要维护。
6. 时间回拨检测只是基础防护
   目前实现是本地时间对比，不是强对抗方案。

## 7. 建议你在另一个项目里直接复用的最小模块清单

建议最少复制出这 5 个模块：

1. `src-tauri/src/activation.rs`
2. `src-tauri/src/main.rs` 里的 6 个 activation/QQ 相关命令
3. `src/renderer/src/components/modals/ActivationModal.tsx`
4. `src/renderer/src/utils/featureGate.ts`
5. 应用入口里的启动检查逻辑

## 8. 当前方案一句话总结

这套方案的本质是：

“用签名激活码提供正式授权，用 QQ 群验证提供可过期的基础版入口，用本地注册表保存状态，用前端 feature gate 做分级访问控制。”
