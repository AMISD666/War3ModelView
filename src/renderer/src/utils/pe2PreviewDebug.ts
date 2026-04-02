/**
 * 粒子发射器 II 实时预览调试：控制台过滤 `[PE2预览]`
 * - 开发构建 (import.meta.env.DEV) 默认输出
 * - 正式环境可执行：localStorage.setItem('PE2_PREVIEW_DEBUG', '1') 后刷新
 */

export function pe2PreviewDebugEnabled(): boolean {
    try {
        // 开发时默认开；若控制台太吵可执行 localStorage.setItem('PE2_PREVIEW_DEBUG', '0')
        if (typeof localStorage !== 'undefined' && localStorage.getItem('PE2_PREVIEW_DEBUG') === '0') {
            return false;
        }
        if (import.meta.env.DEV) return true;
        return typeof localStorage !== 'undefined' && localStorage.getItem('PE2_PREVIEW_DEBUG') === '1';
    } catch {
        return false;
    }
}

/** 简要描述 AnimVector / 标量，便于对比「改参后是否被写成 0」 */
export function describePe2AnimOrScalar(v: unknown, maxKeys = 3): string {
    if (v === undefined) return 'undefined';
    if (v === null) return 'null';
    if (typeof v === 'number') {
        return Number.isFinite(v) ? `scalar=${v}` : `scalar=${String(v)}`;
    }
    if (typeof v === 'object' && v !== null && (v as { Keys?: unknown }).Keys != null) {
        const keysRaw = (v as { Keys: unknown }).Keys;
        const arr = Array.isArray(keysRaw) ? keysRaw : Object.values((keysRaw as object) || {});
        const n = arr.length;
        const parts: string[] = [];
        for (let i = 0; i < Math.min(n, maxKeys); i++) {
            const k = arr[i] as { Frame?: number; Vector?: { [i: number]: number }; Value?: unknown } | undefined;
            const vec = k?.Vector;
            const v0 =
                vec && typeof vec === 'object' && '0' in vec
                    ? (vec as { 0: number })[0]
                    : Array.isArray(vec)
                      ? vec[0]
                      : k?.Value;
            parts.push(`@${k?.Frame ?? '?'}=${v0 ?? '?'}`);
        }
        const more = n > maxKeys ? ` +${n - maxKeys}keys` : '';
        return `anim(keys=${n}${more}) ${parts.join(' ')}`;
    }
    return `type=${typeof v}`;
}
