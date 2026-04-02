/**
 * 最近文件历史记录服务
 * 使用 localStorage 存储最多 MAX_HISTORY 个最近打开的模型路径
 */

const HISTORY_KEY = 'recent_model_files';
const MAX_HISTORY = 10;

export interface RecentFile {
    path: string;
    /** 文件名（不含路径） */
    name: string;
    /** 最近访问时间戳 */
    time: number;
}

/** 读取所有历史记录 */
export function getRecentFiles(): RecentFile[] {
    try {
        const raw = localStorage.getItem(HISTORY_KEY);
        if (!raw) return [];
        return JSON.parse(raw) as RecentFile[];
    } catch {
        return [];
    }
}

/** 将一个路径加入（或刷新到最顶部）历史记录 */
export function addRecentFile(path: string): RecentFile[] {
    if (!path) return getRecentFiles();

    const name = path.replace(/\\/g, '/').split('/').pop() || path;
    const entry: RecentFile = { path, name, time: Date.now() };

    // Remove existing entry for the same path, then prepend
    const existing = getRecentFiles().filter(f => f.path !== path);
    const updated = [entry, ...existing].slice(0, MAX_HISTORY);

    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
    return updated;
}

/** 最近文件条目中的路径替换（例如同目录 MDL/MDX 互转后更新历史） */
export function replaceRecentModelPath(oldPath: string, newPath: string): RecentFile[] {
    if (!newPath) return getRecentFiles();
    const filtered = getRecentFiles().filter(f => f.path !== oldPath && f.path !== newPath);
    const name = newPath.replace(/\\/g, '/').split('/').pop() || newPath;
    const entry: RecentFile = { path: newPath, name, time: Date.now() };
    const updated = [entry, ...filtered].slice(0, MAX_HISTORY);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
    return updated;
}

/** 清空历史记录 */
export function clearRecentFiles(): void {
    localStorage.removeItem(HISTORY_KEY);
}
