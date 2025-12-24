// Activation System Module
// Uses Ed25519 for license verification

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use chrono::Utc;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use std::process::Command;
use uuid::Uuid;
use winreg::enums::*;
use winreg::RegKey;

// ==========================
// Constants
// ==========================
const REG_PATH: &str = "SOFTWARE\\War3ModelEditor";
const LICENSE_KEY: &str = "License";
const MACHINE_ID_KEY: &str = "MachineId";
const LAST_CHECK_TIME_KEY: &str = "LastCheckTime";

// Ed25519 Public Key (Base64 encoded)
const PUBLIC_KEY_B64: &str = "Z2CL61ogkw4qYkEOfz0+aOa0gyST1h3F319IbHqsixE=";

// ==========================
// Data Structures
// ==========================
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LicensePayload {
    pub mid: String, // Machine ID
    pub typ: String, // "PERM" or "TIME"
    pub exp: i64,    // Expiration Unix timestamp (0 = forever)
    pub ver: u32,    // Schema version
    pub iss: String, // Issuer
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivationStatus {
    pub is_activated: bool,
    pub license_type: String,            // "NONE", "PERM", "TIME"
    pub expiration_date: Option<String>, // ISO format or null
    pub days_remaining: Option<i64>,
    pub error: Option<String>,
}

// ==========================
// Machine ID
// ==========================
fn get_wmi_uuid() -> Option<String> {
    // Execute wmic to get motherboard UUID
    let output = Command::new("cmd")
        .args(["/C", "wmic csproduct get uuid"])
        .output()
        .ok()?;

    let stdout = String::from_utf8_lossy(&output.stdout);

    // Parse output: first line is "UUID", second line is the actual UUID
    for line in stdout.lines() {
        let trimmed = line.trim();
        if !trimmed.is_empty() && trimmed != "UUID" {
            // Validate it looks like a UUID
            if trimmed.len() >= 30 && trimmed.contains('-') {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

fn get_or_create_fallback_uuid() -> Result<String, String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);

    // Try to open existing or create new
    let (key, _) = hkcu
        .create_subkey(REG_PATH)
        .map_err(|e| format!("Failed to create registry key: {}", e))?;

    // Try to read existing fallback UUID
    if let Ok(existing) = key.get_value::<String, _>(MACHINE_ID_KEY) {
        if !existing.is_empty() {
            return Ok(existing);
        }
    }

    // Generate new UUID and save
    let new_uuid = Uuid::new_v4().to_string().to_uppercase();
    key.set_value(MACHINE_ID_KEY, &new_uuid)
        .map_err(|e| format!("Failed to save fallback UUID: {}", e))?;

    Ok(new_uuid)
}

pub fn get_machine_id() -> Result<String, String> {
    // Try WMI first
    if let Some(uuid) = get_wmi_uuid() {
        return Ok(uuid);
    }

    // Fallback to registry-persisted UUID
    get_or_create_fallback_uuid()
}

// ==========================
// Registry Operations
// ==========================
fn get_registry_key() -> Result<RegKey, String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = hkcu
        .create_subkey(REG_PATH)
        .map_err(|e| format!("Registry error: {}", e))?;
    Ok(key)
}

pub fn save_license(license_code: &str) -> Result<(), String> {
    let key = get_registry_key()?;
    key.set_value(LICENSE_KEY, &license_code.to_string())
        .map_err(|e| format!("Failed to save license: {}", e))
}

pub fn load_license() -> Option<String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = hkcu.open_subkey(REG_PATH).ok()?;
    key.get_value(LICENSE_KEY).ok()
}

pub fn update_last_check_time() -> Result<(), String> {
    let key = get_registry_key()?;
    let now = Utc::now().timestamp();
    key.set_value(LAST_CHECK_TIME_KEY, &(now as u64))
        .map_err(|e| format!("Failed to update check time: {}", e))
}

pub fn check_time_rollback() -> bool {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = match hkcu.open_subkey(REG_PATH) {
        Ok(k) => k,
        Err(_) => return false, // First run, no check needed
    };

    let last_check: u64 = match key.get_value(LAST_CHECK_TIME_KEY) {
        Ok(v) => v,
        Err(_) => return false, // No previous check time
    };

    let now = Utc::now().timestamp() as u64;

    // If current time is significantly earlier than last check, it's a rollback
    // Allow 1 hour tolerance for timezone/DST changes
    if last_check > now + 3600 {
        return true;
    }

    false
}

// ==========================
// License Verification
// ==========================
fn decode_public_key() -> Result<VerifyingKey, String> {
    let bytes = BASE64
        .decode(PUBLIC_KEY_B64)
        .map_err(|_| "Invalid public key format")?;

    if bytes.len() != 32 {
        return Err("Invalid public key length".to_string());
    }

    let mut key_bytes = [0u8; 32];
    key_bytes.copy_from_slice(&bytes);

    VerifyingKey::from_bytes(&key_bytes).map_err(|_| "Failed to parse public key".to_string())
}

pub fn verify_license(license_code: &str) -> Result<LicensePayload, String> {
    // Split payload and signature
    let parts: Vec<&str> = license_code.split('.').collect();
    if parts.len() != 2 {
        return Err("激活码格式无效".to_string());
    }

    let payload_b64 = parts[0];
    let signature_b64 = parts[1];

    // Decode payload
    let payload_bytes = BASE64.decode(payload_b64).map_err(|_| "激活码解码失败")?;

    let payload_str = String::from_utf8(payload_bytes.clone()).map_err(|_| "激活码解码失败")?;

    // Decode signature
    let sig_bytes = BASE64.decode(signature_b64).map_err(|_| "签名解码失败")?;

    if sig_bytes.len() != 64 {
        return Err("签名长度无效".to_string());
    }

    let mut sig_array = [0u8; 64];
    sig_array.copy_from_slice(&sig_bytes);
    let signature = Signature::from_bytes(&sig_array);

    // Verify signature
    let public_key = decode_public_key()?;
    public_key
        .verify(&payload_bytes, &signature)
        .map_err(|_| "签名验证失败，激活码无效".to_string())?;

    // Parse payload JSON
    let payload: LicensePayload =
        serde_json::from_str(&payload_str).map_err(|_| "激活码数据解析失败".to_string())?;

    // Verify machine ID
    let current_mid = get_machine_id()?;
    if payload.mid != current_mid {
        return Err("激活码与本机不匹配".to_string());
    }

    // Verify issuer
    if payload.iss != "War3ModelEditor" {
        return Err("激活码发行者无效".to_string());
    }

    // Verify expiration (for TIME licenses)
    if payload.typ == "TIME" && payload.exp > 0 {
        let now = Utc::now().timestamp();
        if now > payload.exp {
            return Err("激活码已过期".to_string());
        }
    }

    Ok(payload)
}

pub fn get_activation_status() -> ActivationStatus {
    // Check for time rollback first
    if check_time_rollback() {
        return ActivationStatus {
            is_activated: false,
            license_type: "NONE".to_string(),
            expiration_date: None,
            days_remaining: None,
            error: Some("系统时间异常，请检查并恢复正确的系统时间".to_string()),
        };
    }

    // Load and verify license
    let license_code = match load_license() {
        Some(code) => code,
        None => {
            return ActivationStatus {
                is_activated: false,
                license_type: "NONE".to_string(),
                expiration_date: None,
                days_remaining: None,
                error: None,
            };
        }
    };

    match verify_license(&license_code) {
        Ok(payload) => {
            // Update last check time on successful verification
            let _ = update_last_check_time();

            let (exp_date, days_rem) = if payload.typ == "TIME" && payload.exp > 0 {
                let now = Utc::now().timestamp();
                let remaining_seconds = payload.exp - now;
                let remaining_days = remaining_seconds / 86400;

                let exp_datetime = chrono::DateTime::from_timestamp(payload.exp, 0);
                let exp_str = exp_datetime.map(|dt| dt.format("%Y-%m-%d").to_string());

                (exp_str, Some(remaining_days))
            } else {
                (None, None)
            };

            ActivationStatus {
                is_activated: true,
                license_type: payload.typ,
                expiration_date: exp_date,
                days_remaining: days_rem,
                error: None,
            }
        }
        Err(e) => ActivationStatus {
            is_activated: false,
            license_type: "NONE".to_string(),
            expiration_date: None,
            days_remaining: None,
            error: Some(e),
        },
    }
}

pub fn activate_software(license_code: &str) -> Result<ActivationStatus, String> {
    // Verify the license first
    let payload = verify_license(license_code)?;

    // Save to registry
    save_license(license_code)?;

    // Update last check time
    update_last_check_time()?;

    // Return status
    let (exp_date, days_rem) = if payload.typ == "TIME" && payload.exp > 0 {
        let now = Utc::now().timestamp();
        let remaining_seconds = payload.exp - now;
        let remaining_days = remaining_seconds / 86400;

        let exp_datetime = chrono::DateTime::from_timestamp(payload.exp, 0);
        let exp_str = exp_datetime.map(|dt| dt.format("%Y-%m-%d").to_string());

        (exp_str, Some(remaining_days))
    } else {
        (None, None)
    };

    Ok(ActivationStatus {
        is_activated: true,
        license_type: payload.typ,
        expiration_date: exp_date,
        days_remaining: days_rem,
        error: None,
    })
}
