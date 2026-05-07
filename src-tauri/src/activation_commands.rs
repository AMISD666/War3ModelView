use crate::{activation, remote_activation_policy};
use clipboard_win::{formats::Unicode, Clipboard, Setter};
use tauri::Manager;

#[tauri::command]
pub fn get_machine_id() -> Result<String, String> {
    activation::get_machine_id()
}

#[tauri::command]
pub fn copy_machine_id_to_clipboard() -> Result<String, String> {
    let machine_id = activation::get_machine_id()?;
    let _clipboard = Clipboard::new_attempts(10).map_err(|e| format!("无法打开剪贴板: {}", e))?;
    Unicode
        .write_clipboard(&machine_id)
        .map_err(|e| format!("复制本机机器码失败: {}", e))?;
    Ok(machine_id)
}

#[tauri::command]
pub fn get_activation_status() -> activation::ActivationStatus {
    activation::get_activation_status()
}

#[tauri::command]
pub fn get_qq_activation_policy() -> remote_activation_policy::QqActivationPolicy {
    remote_activation_policy::get_qq_activation_policy()
}

#[tauri::command]
pub fn clear_qq_activation_policy_cache() -> Result<(), String> {
    remote_activation_policy::clear_qq_activation_policy_cache()
}

#[tauri::command]
pub fn activate_software(license_code: String) -> Result<activation::ActivationStatus, String> {
    activation::activate_software(&license_code)
}

#[tauri::command]
pub async fn open_qq_verification_window(app: tauri::AppHandle) -> Result<(), String> {
    activation::ensure_qq_activation_allowed()?;

    let label = "qq_verification";
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.destroy();
        std::thread::sleep(std::time::Duration::from_millis(200));
    }

    let url = "https://xui.ptlogin2.qq.com/cgi-bin/xlogin?pt_disable_pwd=1&appid=715030901&daid=73&hide_close_icon=1&pt_no_auth=1&s_url=https%3A%2F%2Fqun.qq.com%2Fmember.html%23";
    let script = format!(
        r##"
        (function() {{
            const targetId = "{0}";
            const successHash = "#verified_ok_{0}";
            setInterval(() => {{
                try {{
                    const html = document.documentElement ? document.documentElement.innerHTML : "";
                    if (!html) return;
                    if (html.includes(targetId) || html.includes('data-id="' + targetId + '"')) {{
                        if (window.location.hash !== successHash) {{
                            window.location.hash = successHash;
                        }}
                    }}
                }} catch (_) {{}}
            }}, 1000);
        }})();
        "##,
        activation::QQ_TARGET_GROUP_ID
    );

    let external_url =
        tauri::WebviewUrl::External(tauri::Url::parse(url).map_err(|e| e.to_string())?);
    tauri::WebviewWindowBuilder::new(&app, label, external_url)
        .title("QQ 群成员验证")
        .inner_size(1024.0, 768.0)
        .resizable(true)
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
        .initialization_script(&script)
        .build()
        .map_err(|e| format!("Failed to open QQ verification window: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn check_qq_verification_window_status(app: tauri::AppHandle) -> Result<bool, String> {
    let success_flag = format!("verified_ok_{}", activation::QQ_TARGET_GROUP_ID);
    if let Some(window) = app.get_webview_window("qq_verification") {
        let current_url = window.url().map_err(|e| e.to_string())?.to_string();
        if current_url.contains(&success_flag) {
            activation::save_qq_verification_now()?;
            let _ = window.destroy();
            return Ok(true);
        }
    }
    Ok(false)
}

#[tauri::command]
pub fn close_qq_verification_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("qq_verification") {
        let _ = window.destroy();
    }
    Ok(())
}
