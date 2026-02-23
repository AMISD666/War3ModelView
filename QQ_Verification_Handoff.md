# QQ群验证功能完整实现方案（AI Handoff 文档）

> **用途**：将本文档完整复制给另一个项目的AI，AI即可按此方案从零实现QQ群成员验证功能。
> **技术栈**：Tauri v2 + Vue 3 + Rust（Windows平台）

---

## 一、功能原理

用户点击登录按钮 → Tauri打开一个**独立Webview窗口**加载QQ登录页 → 用户扫码登录后页面跳转至群成员列表 → **注入的JS脚本**在页面HTML中搜索目标群ID → 找到后修改`window.location.hash` → 主窗口前端**轮询**后端检查hash → 验证成功 → 时间戳存入**Windows注册表**（30天有效）。

---

## 二、白屏问题排查清单（必读！）

打开QQ登录窗口白屏通常由以下原因导致：

### ❶ CSP (Content Security Policy) 阻止了外部URL加载
**这是最常见的原因。** Tauri默认的CSP会阻止加载外部网页。

**解决方案**：在 `tauri.conf.json` 中将CSP设为 `null`：
```json
{
  "app": {
    "security": {
      "csp": null
    }
  }
}
```

> **⚠️ 极其关键**：如果CSP不是null或者没有显式允许 `https://xui.ptlogin2.qq.com` 和 `https://qun.qq.com`，Webview会拒绝加载页面内容，导致白屏。

### ❷ URL格式错误或缺少External包装
Tauri v2 的 `WebviewUrl` 必须使用 `External` 变体来加载外部URL：
```rust
// ✅ 正确
WebviewUrl::External(url.parse().unwrap())

// ❌ 错误 - 这会尝试加载本地文件
WebviewUrl::App("https://...".into())
```

### ❸ Tauri v2 权限配置
确保 `src-tauri/capabilities/default.json` 中没有限制窗口创建的权限。如果该文件存在IPC权限约束，需要确保 `open_qq_login_window` 和 `check_verification_window_status` 命令被允许。

### ❹ WebView2 兼容性
Windows上QQ登录页面需要较新版本的Edge WebView2。如果用户系统上的WebView2版本太旧，可能无法正确渲染QQ登录页。建议在NSIS安装包中捆绑WebView2 bootstrapper。

---

## 三、Rust后端代码（完整可用）

### 3.1 依赖 (`Cargo.toml`)
```toml
[dependencies]
tauri = { version = "2", features = [] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
winreg = "0.52"   # Windows注册表操作
```

### 3.2 常量定义
```rust
use winreg::enums::*;
use winreg::RegKey;

// 注册表路径和键名，请替换为你自己项目的名称
const REG_PATH: &str = "Software\\YourAppName";
const REG_KEY_QQ_VERIF: &str = "QQVerif";
```

### 3.3 打开QQ登录窗口（核心函数）
```rust
#[tauri::command]
pub async fn open_qq_login_window(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::{WebviewUrl, WebviewWindowBuilder, Manager};

    // QQ登录URL → 登录成功后自动跳转到群成员页面
    // s_url 参数指定登录成功后跳转到 qun.qq.com/member.html
    let url = "https://xui.ptlogin2.qq.com/cgi-bin/xlogin?\
        pt_disable_pwd=1&appid=715030901&daid=73&\
        hide_close_icon=1&pt_no_auth=1&\
        s_url=https%3A%2F%2Fqun.qq.com%2Fmember.html%23";

    let window_label = "qq_verification";

    // 如果窗口已存在，直接聚焦
    if let Some(win) = app.get_webview_window(window_label) {
        let _ = win.set_focus();
        return Ok(());
    }

    // ★ 核心：注入到QQ页面中的探测脚本
    // 原理：登录成功后页面会显示用户所在的群列表
    // 脚本每秒检查页面HTML中是否包含目标群ID
    // 找到后修改 window.location.hash 作为信号
    let script = r##"
        (function() {
            console.log("QQ Verification: Starting detection loop");
            let targetId = "168886891";  // ← 替换为你的目标群号
            let successHash = "#verified_ok_168886891";

            setInterval(() => {
                try {
                    // 在整个页面HTML中搜索群ID
                    let html = document.documentElement.innerHTML;
                    if (html.includes(targetId) || html.includes("data-id=\"" + targetId + "\"")) {
                        // 设置hash信号（不会引起页面刷新）
                        if (window.location.hash !== successHash) {
                            window.location.hash = successHash;
                            console.log("QQ Verification: SUCCESS - Group found!");
                        }
                    }
                } catch(e) {
                    console.error("QQ Verification Error:", e);
                }
            }, 1000);
        })();
    "##;

    // 创建独立的验证窗口
    WebviewWindowBuilder::new(
        &app,
        window_label,
        WebviewUrl::External(url.parse().unwrap())  // ★ 必须用 External
    )
    .title("QQ群验证 - 请扫码登录")
    .inner_size(1024.0, 768.0)
    .initialization_script(script)  // ★ 注入探测脚本
    .build()
    .map_err(|e| e.to_string())?;

    Ok(())
}
```

### 3.4 检查验证窗口状态
```rust
#[tauri::command]
pub fn check_verification_window_status(app: tauri::AppHandle) -> Result<bool, String> {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window("qq_verification") {
        let url = window.url().map_err(|e| e.to_string())?;
        let url_str = url.to_string();

        // 检查脚本是否已经设置了成功标识
        if url_str.contains("verified_ok_168886891") {
            println!("Verification SUCCESS detected!");
            let _ = window.close(); // 自动关闭验证窗口
            return Ok(true);
        }
    }
    Ok(false)
}
```

### 3.5 注册表持久化（30天免验证）
```rust
#[tauri::command]
pub fn save_qq_verification(value: String) -> Result<(), String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = hkcu.create_subkey(REG_PATH).map_err(|e| e.to_string())?;
    key.set_value(REG_KEY_QQ_VERIF, &value).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn load_qq_verification() -> Result<Option<String>, String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    if let Ok(key) = hkcu.open_subkey(REG_PATH) {
        if let Ok(value) = key.get_value::<String, _>(REG_KEY_QQ_VERIF) {
            return Ok(Some(value));
        }
    }
    Ok(None)
}
```

### 3.6 注册命令 (`lib.rs`)
```rust
// 在 tauri::Builder 的 invoke_handler 中注册这4个命令：
.invoke_handler(tauri::generate_handler![
    // ... 你的其他命令 ...
    commands::open_qq_login_window,
    commands::check_verification_window_status,
    commands::save_qq_verification,
    commands::load_qq_verification
])
```

---

## 四、Vue前端代码（完整可用）

### 4.1 验证弹窗组件 (`QQVerificationModal.vue`)
```vue
<template>
  <div v-if="visible" class="modal-overlay">
    <div class="modal-window">
      <h2>QQ群成员验证</h2>
      <p>请先加群: <strong>168886891</strong></p>

      <div v-if="loading" class="status-box">
        <span>正在检查验证状态...</span>
      </div>

      <div v-if="errorMsg" class="error-box">❌ {{ errorMsg }}</div>

      <button @click="openLogin" :disabled="loading">
        {{ loading ? '正在监听登录状态...' : '点击登录QQ' }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, onUnmounted } from 'vue';
import { invoke } from '@tauri-apps/api/core';

const props = defineProps({ visible: Boolean });
const emit = defineEmits(['update:visible', 'success']);

const loading = ref(false);
const errorMsg = ref('');
const pollingInterval = ref(null);

const stopPolling = () => {
    if (pollingInterval.value) {
        clearInterval(pollingInterval.value);
        pollingInterval.value = null;
    }
};

// 1. 打开QQ登录窗口
const openLogin = async () => {
    errorMsg.value = '';
    try {
        await invoke('open_qq_login_window');
        startPolling(); // 打开后立刻开始轮询
    } catch (e) {
        errorMsg.value = "无法打开登录窗口: " + e;
    }
};

// 2. 每2秒询问后端：用户验证成功了吗？
const startPolling = () => {
    stopPolling();
    loading.value = true;

    pollingInterval.value = setInterval(async () => {
        try {
            const verified = await invoke('check_verification_window_status');
            if (verified) {
                stopPolling();
                loading.value = false;
                emit('success');
                emit('update:visible', false);
            }
        } catch (e) {
            console.error("Polling error:", e);
        }
    }, 2000);
};

onUnmounted(stopPolling);
</script>
```

### 4.2 应用启动时的校验逻辑 (`App.vue`)
```javascript
import { onMounted, ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';

const showQQVerification = ref(false);
const isQqVerified = ref(false);

// 验证成功时的回调
const handleQQSuccess = async () => {
    try {
        // 把当前时间戳存入注册表
        await invoke('save_qq_verification', {
            value: JSON.stringify({ timestamp: new Date().toISOString() })
        });
        isQqVerified.value = true;
    } catch (e) {
        console.error("Save verification failed", e);
    }
};

onMounted(async () => {
    // 启动时检查注册表中的验证状态
    try {
        const dataStr = await invoke('load_qq_verification');
        if (dataStr) {
            const data = JSON.parse(dataStr);
            if (data.timestamp) {
                const daysDiff = (Date.now() - new Date(data.timestamp).getTime()) / (1000 * 3600 * 24);
                if (daysDiff < 30) {
                    isQqVerified.value = true; // 30天内免验证
                }
            }
        }
    } catch (e) {
        console.error("Load verification failed", e);
    }

    // 如果未验证，弹出验证窗口
    if (!isQqVerified.value) {
        showQQVerification.value = true;
    }
});
```

---

## 五、`tauri.conf.json` 关键配置

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "app": {
    "security": {
      "csp": null
    }
  }
}
```

> **`"csp": null` 是防止白屏的关键！** 不设为null则外部URL无法加载。

---

## 六、完整流程时序图

```
用户点击"登录QQ"
       │
       ▼
[前端] invoke('open_qq_login_window')
       │
       ▼
[后端] 创建Webview窗口，加载QQ登录URL + 注入JS脚本
       │
       ▼
[用户] 在弹出窗口中扫码登录QQ
       │
       ▼
[QQ]   登录成功，页面跳转到群成员列表页
       │
       ▼
[JS脚本] 每秒检查 innerHTML 是否包含目标群ID
       │
       ▼ (找到群ID)
[JS脚本] 设置 window.location.hash = "#verified_ok_168886891"
       │
       ▼
[前端] setInterval 每2秒调用 invoke('check_verification_window_status')
       │
       ▼
[后端] 读取窗口URL → 检测到hash中包含 "verified_ok_168886891"
       │
       ▼
[后端] 关闭验证窗口，返回 true
       │
       ▼
[前端] 收到 true → invoke('save_qq_verification') 存入注册表
       │
       ▼
[完成] 下次启动时读取注册表，30天内跳过验证
```

---

## 七、替换为你自己的群号

需要修改以下位置：
1. **后端 `open_qq_login_window`**：JS脚本中的 `targetId = "你的群号"` 和 `successHash`
2. **后端 `check_verification_window_status`**：`url_str.contains("verified_ok_你的群号")`
3. **前端提示文字**：弹窗中显示的群号
