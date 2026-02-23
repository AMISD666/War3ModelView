# QQ群验证功能实现技术文档

本文档详细说明了“QQ群验证”功能的实现细节，以便在其他项目中复用此逻辑。

## 1. 核心流程概述

该功能旨在通过验证用户是否为指定QQ群的成员来解锁付费功能。由于QQ没有公开的群成员查询API，我们采用了**模拟登录+页面内容探测**的方案。

1.  **前端触发**：用户点击登录按钮。
2.  **后端弹窗**：后端（Tauri/Rust）打开一个独立的浏览器窗口（Webview），加载QQ登录及群管理页面。
3.  **脚本探测**：后端向该窗口注入JavaScript脚本，不断检索页面内容，寻找指定的群ID。
4.  **状态反馈**：一旦脚本在页面中探测到群ID，修改窗口URL的 `hash` 值。
5.  **前端轮询**：前端通过定时器不断询问后端窗口状态。
6.  **持久化保存**：验证成功后，将验证时间戳保存至注册表，实现离线持久化。

---

## 2. 后端实现 (Rust/Tauri)

### 2.1 依赖
- `tauri`: Webview窗口管理。
- `winreg`: Windows注册表操作。
- `serde`: 数据序列化。

### 2.2 核心配置
- **注册表路径**: `HKEY_CURRENT_USER\Software\GGWar3IconTool`
- **键名**: `QQVerif`
- **目标群ID**: `168886891`

### 2.3 核心代码逻辑 (`commands.rs`)

#### A. 打开验证窗口
```rust
#[tauri::command]
pub async fn open_qq_login_window(app: tauri::AppHandle) -> Result<(), String> {
    // QQ群成员页面URL
    let url = "https://xui.ptlogin2.qq.com/cgi-bin/xlogin?pt_disable_pwd=1&appid=715030901&daid=73&hide_close_icon=1&pt_no_auth=1&s_url=https%3A%2F%2Fqun.qq.com%2Fmember.html%23";
    
    // 注入探测脚本：寻找群ID "168886891"，找到后修改URL hash
    let script = r##"
        (function() {
            let targetId = "168886891";
            let successHash = "#verified_ok_168886891";
            setInterval(() => {
                try {
                    let html = document.documentElement.innerHTML;
                    if (html.includes(targetId)) {
                        if (window.location.hash !== successHash) {
                            window.location.hash = successHash;
                        }
                    }
                } catch(e) {}
            }, 1000);
        })();
    "##;

    tauri::WebviewWindowBuilder::new(&app, "qq_verification", tauri::WebviewUrl::External(url.parse().unwrap()))
        .title("QQ验证")
        .initialization_script(script)
        .build().map_err(|e| e.to_string())?;
    Ok(())
}
```

#### B. 检查窗口状态
```rust
#[tauri::command]
pub fn check_verification_window_status(app: tauri::AppHandle) -> Result<bool, String> {
    if let Some(window) = app.get_webview_window("qq_verification") {
        let url = window.url().map_err(|e| e.to_string())?.to_string();
        if url.contains("verified_ok_168886891") {
            let _ = window.close(); // 验证成功，自动关闭窗口
            return Ok(true);
        }
    }
    Ok(false)
}
```

#### C. 注册表持久化
```rust
#[tauri::command]
pub fn save_qq_verification(value: String) -> Result<(), String> {
    let hkcu = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER);
    let (key, _) = hkcu.create_subkey("Software\\GGWar3IconTool").map_err(|e| e.to_string())?;
    key.set_value("QQVerif", &value).map_err(|e| e.to_string())?;
    Ok(())
}
```

---

## 3. 前端实现 (Vue 3)

### 3.1 自动轮询逻辑 (`QQVerificationModal.vue`)
当用户点击“登录”后，前端开启一个 2 秒一次的定时器：

```javascript
const startPolling = () => {
    loading.value = true;
    const timer = setInterval(async () => {
        const verified = await invoke('check_verification_window_status');
        if (verified) {
            clearInterval(timer);
            emit('success'); // 触发父组件成功回调
        }
    }, 2000);
};
```

### 3.2 启动校验与过期策略 (`App.vue`)
在应用挂载时进行校验：

1.  **加载状态**：调用 `load_qq_verification` 读取注册表。
2.  **过期检查**：比较当前时间与保存的时间戳。
3.  **有效期设置**：
    - 在本项目中，设置为 **30天** 免重新验证。
    - 策略建议：`if (daysDiff < 30) { isVerified = true; }`

---

## 4. 关键点与注意事项

1.  **URL检测机制**：之所以修改 `window.location.hash`，是因为它是纯前端属性，不会引起页面重新加载，且后端可以随时通过 `window.url()` 读取到。
2.  **脚本注入时机**：使用 Tauri 的 `initialization_script` 确保脚本在页面 DOM 加载前注入，从而能够实时监听后续的登录成功跳转。
3.  **Registry 安全性**：存储的是验证通过的时间戳（JSON字符串），虽然用户可以在注册表中手动修改，但对于常规破解已有足够的防御性。如需更高安全性，可对时间戳进行简单的异或加密或签名。
4.  **UI 提示**：必须明确提示用户需要加入哪个群号，避免用户登录成功后探测不到对应的群 ID。
