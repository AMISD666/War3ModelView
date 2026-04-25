use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use chrono::Utc;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use winreg::enums::*;
use winreg::RegKey;

use crate::activation::{PUBLIC_KEY_B64, REG_PATH};

const DEFAULT_QQ_POLICY_URL: &str =
    "https://gitee.com/amisd666/gg-war3-model-edit/raw/master/activation/qq-policy.txt";
const QQ_POLICY_CACHE_KEY: &str = "QQRemotePolicyCache";
const QQ_POLICY_CACHE_SECONDS: i64 = 24 * 60 * 60;
const QQ_POLICY_REQUEST_TIMEOUT_SECONDS: u64 = 10;

#[derive(Debug, Clone, Serialize)]
pub struct QqActivationPolicy {
    pub qq_activation_enabled: bool,
    pub message: Option<String>,
    pub policy_source: String,
    pub debug: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SignedPolicyPayload {
    schema: u32,
    policy_version: u64,
    qq_activation_enabled: bool,
    #[serde(default)]
    message: Option<String>,
    #[serde(default)]
    iss: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CachedPolicy {
    fetched_at: i64,
    policy_version: u64,
    qq_activation_enabled: bool,
    message: Option<String>,
}

impl CachedPolicy {
    fn is_fresh(&self, now: i64) -> bool {
        self.policy_version > 0
            && self.fetched_at > 0
            && self.fetched_at <= now + 3600
            && now.saturating_sub(self.fetched_at) < QQ_POLICY_CACHE_SECONDS
    }

    fn into_policy(self) -> QqActivationPolicy {
        QqActivationPolicy {
            qq_activation_enabled: self.qq_activation_enabled,
            message: self.message,
            policy_source: "registry-cache".to_string(),
            debug: format!(
                "fetched_at={}, policy_version={}",
                self.fetched_at, self.policy_version
            ),
        }
    }
}

impl From<SignedPolicyPayload> for QqActivationPolicy {
    fn from(payload: SignedPolicyPayload) -> Self {
        Self {
            qq_activation_enabled: payload.qq_activation_enabled,
            message: payload.message,
            policy_source: "remote".to_string(),
            debug: format!(
                "schema={}, policy_version={}, iss={}",
                payload.schema, payload.policy_version, payload.iss
            ),
        }
    }
}

pub fn get_qq_activation_policy() -> QqActivationPolicy {
    let now = Utc::now().timestamp();
    eprintln!("[QQPolicy] get_qq_activation_policy now={}", now);
    let cached = load_cached_policy();

    match &cached {
        Some(policy) => eprintln!(
            "[QQPolicy] registry cache found fetched_at={} policy_version={} enabled={} fresh={}",
            policy.fetched_at,
            policy.policy_version,
            policy.qq_activation_enabled,
            policy.is_fresh(now)
        ),
        None => eprintln!("[QQPolicy] registry cache not found or failed to parse"),
    }

    if let Some(policy) = cached
        .as_ref()
        .filter(|policy| policy.is_fresh(now) && policy.qq_activation_enabled)
    {
        eprintln!(
            "[QQPolicy] using registry cache enabled={} message={:?}",
            policy.qq_activation_enabled, policy.message
        );
        return policy.clone().into_policy();
    }

    if cached.as_ref().is_some_and(|policy| policy.is_fresh(now)) {
        eprintln!(
            "[QQPolicy] registry cache is disabled; refreshing remote before using it"
        );
    }

    let Some(url) = configured_policy_url() else {
        eprintln!("[QQPolicy] no policy URL configured, default enabled");
        return default_enabled_policy("no policy URL configured");
    };

    eprintln!("[QQPolicy] fetching remote policy url={}", url);
    match fetch_signed_policy(url) {
        Ok(payload) => {
            eprintln!(
                "[QQPolicy] remote policy verified schema={} policy_version={} enabled={} message={:?} iss={}",
                payload.schema,
                payload.policy_version,
                payload.qq_activation_enabled,
                payload.message,
                payload.iss
            );
            let cached_policy = CachedPolicy {
                fetched_at: now,
                policy_version: payload.policy_version,
                qq_activation_enabled: payload.qq_activation_enabled,
                message: payload.message.clone(),
            };
            match save_cached_policy(&cached_policy) {
                Ok(()) => eprintln!("[QQPolicy] saved registry cache"),
                Err(error) => eprintln!("[QQPolicy] failed to save registry cache: {}", error),
            }
            payload.into()
        }
        Err(error) => {
            eprintln!(
                "[QQPolicy] remote policy fetch/verify failed: {}",
                error
            );
            if let Some(policy) = cached.filter(|policy| policy.is_fresh(now)) {
                eprintln!(
                    "[QQPolicy] remote failed; falling back to fresh registry cache enabled={}",
                    policy.qq_activation_enabled
                );
                policy.into_policy()
            } else {
                eprintln!("[QQPolicy] remote failed and no fresh cache; default enabled");
                default_enabled_policy(&format!("remote policy failed: {}", error))
            }
        }
    }
}

pub fn clear_qq_activation_policy_cache() -> Result<(), String> {
    let key = registry_key()?;
    match key.delete_value(QQ_POLICY_CACHE_KEY) {
        Ok(()) => {
            eprintln!("[QQPolicy] cleared registry cache");
            Ok(())
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            eprintln!("[QQPolicy] registry cache already absent");
            Ok(())
        }
        Err(error) => Err(format!("清除QQ远程策略缓存失败: {}", error)),
    }
}

fn default_enabled_policy(debug: &str) -> QqActivationPolicy {
    QqActivationPolicy {
        qq_activation_enabled: true,
        message: None,
        policy_source: "default-enabled".to_string(),
        debug: debug.to_string(),
    }
}

fn configured_policy_url() -> Option<&'static str> {
    let url = option_env!("WAR3_QQ_POLICY_URL")
        .unwrap_or(DEFAULT_QQ_POLICY_URL)
        .trim();

    if url.is_empty() {
        None
    } else {
        Some(url)
    }
}

fn fetch_signed_policy(url: &str) -> Result<SignedPolicyPayload, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(
            QQ_POLICY_REQUEST_TIMEOUT_SECONDS,
        ))
        .build()
        .map_err(|e| format!("创建远程策略客户端失败: {}", e))?;

    let response = client
        .get(url)
        .header(reqwest::header::CACHE_CONTROL, "no-cache")
        .send()
        .map_err(|e| format!("读取远程QQ验证策略失败: {}", e))?;

    eprintln!("[QQPolicy] remote HTTP status={}", response.status());
    if !response.status().is_success() {
        return Err(format!("远程QQ验证策略状态异常: {}", response.status()));
    }

    let body = response
        .text()
        .map_err(|e| format!("读取远程QQ验证策略内容失败: {}", e))?;

    eprintln!(
        "[QQPolicy] remote body len={} dot_count={} prefix={}",
        body.len(),
        body.matches('.').count(),
        body.chars().take(80).collect::<String>()
    );
    verify_signed_policy(body.trim())
}

fn verify_signed_policy(signed_policy: &str) -> Result<SignedPolicyPayload, String> {
    eprintln!(
        "[QQPolicy] verifying signed policy len={} dot_count={}",
        signed_policy.len(),
        signed_policy.matches('.').count()
    );
    let parts: Vec<&str> = signed_policy.split('.').collect();
    if parts.len() != 2 {
        return Err("远程QQ验证策略格式无效".to_string());
    }

    let payload_bytes = BASE64
        .decode(parts[0])
        .map_err(|_| "远程QQ验证策略解码失败".to_string())?;

    let sig_bytes = BASE64
        .decode(parts[1])
        .map_err(|_| "远程QQ验证策略签名解码失败".to_string())?;

    if sig_bytes.len() != 64 {
        return Err("远程QQ验证策略签名长度无效".to_string());
    }

    let mut sig_array = [0u8; 64];
    sig_array.copy_from_slice(&sig_bytes);
    let signature = Signature::from_bytes(&sig_array);

    let public_key = decode_public_key()?;
    public_key
        .verify(&payload_bytes, &signature)
        .map_err(|_| "远程QQ验证策略签名验证失败".to_string())?;

    let payload_str =
        String::from_utf8(payload_bytes).map_err(|_| "远程QQ验证策略不是有效文本".to_string())?;
    eprintln!("[QQPolicy] decoded payload={}", payload_str);
    let payload: SignedPolicyPayload =
        serde_json::from_str(&payload_str).map_err(|_| "远程QQ验证策略数据解析失败".to_string())?;

    if payload.schema != 1 {
        return Err("远程QQ验证策略版本不支持".to_string());
    }

    if !payload.iss.is_empty() && payload.iss != "War3ModelEditor" {
        return Err("远程QQ验证策略发行者无效".to_string());
    }

    Ok(payload)
}

fn decode_public_key() -> Result<VerifyingKey, String> {
    let bytes = BASE64
        .decode(PUBLIC_KEY_B64)
        .map_err(|_| "远程QQ验证策略公钥格式无效".to_string())?;

    if bytes.len() != 32 {
        return Err("远程QQ验证策略公钥长度无效".to_string());
    }

    let mut key_bytes = [0u8; 32];
    key_bytes.copy_from_slice(&bytes);

    VerifyingKey::from_bytes(&key_bytes).map_err(|_| "远程QQ验证策略公钥解析失败".to_string())
}

fn registry_key() -> Result<RegKey, String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = hkcu
        .create_subkey(REG_PATH)
        .map_err(|e| format!("Registry error: {}", e))?;
    Ok(key)
}

fn load_cached_policy() -> Option<CachedPolicy> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = match hkcu.open_subkey(REG_PATH) {
        Ok(key) => key,
        Err(error) => {
            eprintln!("[QQPolicy] open registry cache key failed: {}", error);
            return None;
        }
    };
    let raw: String = match key.get_value(QQ_POLICY_CACHE_KEY) {
        Ok(raw) => raw,
        Err(error) => {
            eprintln!("[QQPolicy] read registry cache value failed: {}", error);
            return None;
        }
    };
    eprintln!("[QQPolicy] registry cache raw={}", raw);
    match serde_json::from_str(&raw) {
        Ok(policy) => Some(policy),
        Err(error) => {
            eprintln!("[QQPolicy] parse registry cache failed: {}", error);
            None
        }
    }
}

fn save_cached_policy(policy: &CachedPolicy) -> Result<(), String> {
    let key = registry_key()?;
    let raw =
        serde_json::to_string(policy).map_err(|e| format!("远程QQ验证策略缓存失败: {}", e))?;
    key.set_value(QQ_POLICY_CACHE_KEY, &raw)
        .map_err(|e| format!("保存远程QQ验证策略缓存失败: {}", e))
}
