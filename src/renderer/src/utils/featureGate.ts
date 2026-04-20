import { desktopGateway } from '../infrastructure/desktop';

/**
 * Feature Gate Utility
 * Manages license-based feature access for tiered activation system.
 * 
 * License Levels:
 * - 0: Not activated (limited features)
 * - 1: Basic (基础版)
 * - 2: Pro (高级版)
 */

export interface ActivationStatus {
    is_activated: boolean;
    license_type: string;        // "NONE", "PERM", "TIME", "QQ"
    expiration_date: string | null;
    days_remaining: number | null;
    error: string | null;
    level: number;               // 0, 1, 2
    level_name: string;          // "未激活", "基础版", "高级版"
}

// Cache the activation status to avoid repeated IPC calls
let cachedStatus: ActivationStatus | null = null;
let cacheTime: number = 0;
const CACHE_DURATION_MS = 5000; // 5 seconds cache

/**
 * Get current activation status (cached for performance)
 */
export async function getActivationStatus(forceRefresh: boolean = false): Promise<ActivationStatus> {
    const now = Date.now();

    if (!forceRefresh && cachedStatus && (now - cacheTime) < CACHE_DURATION_MS) {
        return cachedStatus;
    }

    try {
        cachedStatus = await desktopGateway.invoke<ActivationStatus>('get_activation_status');
        cacheTime = now;
        return cachedStatus;
    } catch (error) {
        console.error('[FeatureGate] Failed to get activation status:', error);
        // Return a default "not activated" status on error
        return {
            is_activated: false,
            license_type: 'NONE',
            expiration_date: null,
            days_remaining: null,
            error: String(error),
            level: 0,
            level_name: '未激活'
        };
    }
}

/**
 * Clear the cached status (call after activation/upgrade)
 */
export function clearActivationCache(): void {
    cachedStatus = null;
    cacheTime = 0;
}

/**
 * Check if user has at least the specified license level
 * @param requiredLevel Minimum required level (1 = Basic, 2 = Pro)
 */
export async function hasLicenseLevel(requiredLevel: number): Promise<boolean> {
    const status = await getActivationStatus();
    return status.level >= requiredLevel;
}

/**
 * Check if user has Pro license (level 2)
 */
export async function isProUser(): Promise<boolean> {
    return hasLicenseLevel(2);
}

/**
 * Check if user has at least Basic license (level 1)
 */
export async function isBasicUser(): Promise<boolean> {
    return hasLicenseLevel(1);
}

/**
 * Check if a Pro-only feature is accessible, show alert if not
 * @param featureName Name of the feature for the error message
 * @returns true if accessible, false if blocked
 */
export async function requireProFeature(featureName: string): Promise<boolean> {
    if (await isProUser()) {
        return true;
    }

    const status = await getActivationStatus();
    if (status.level === 0) {
        alert(`"${featureName}" 需要激活软件才能使用。\n\n请在 启动弹窗 或 帮助 → 关于 中输入激活码，或完成QQ群成员验证。`);
    } else {
        alert(`"${featureName}" 是高级版功能。\n\n当前版本: ${status.level_name}\n请升级到高级版以使用此功能。`);
    }
    return false;
}

/**
 * Check if a Basic-or-higher feature is accessible, show alert if not
 * @param featureName Name of the feature for the error message
 * @returns true if accessible, false if blocked
 */
export async function requireBasicFeature(featureName: string): Promise<boolean> {
    if (await isBasicUser()) {
        return true;
    }

    alert(`"${featureName}" 需要激活软件才能使用。\n\n请在 启动弹窗 或 帮助 → 关于 中输入激活码，或完成QQ群成员验证。`);
    return false;
}

/**
 * Activate software with a license code
 * @param licenseCode The license code to activate
 * @returns ActivationStatus on success, throws on error
 */
export async function activateSoftware(licenseCode: string): Promise<ActivationStatus> {
    const result = await desktopGateway.invoke<ActivationStatus>('activate_software', { licenseCode });

    // Clear cache so next check gets fresh data
    clearActivationCache();

    return result;
}
