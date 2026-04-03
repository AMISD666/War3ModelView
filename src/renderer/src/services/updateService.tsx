
import React from 'react';
import { showMessage, showConfirm, useMessageStore } from '../store/messageStore';
import { getVersion } from '@tauri-apps/api/app';
import { fetch } from '@tauri-apps/plugin-http';
import { tempDir } from '@tauri-apps/api/path';
import { open } from '@tauri-apps/plugin-shell';
import { exit } from '@tauri-apps/plugin-process';
import { UpdateLogContent } from '../components/UpdateLogContent';

const GITEE_REPO = 'AMISD666/gg-war3-model-edit';
const API_URL = `https://gitee.com/api/v5/repos/${GITEE_REPO}/releases/latest`;
const API_LIST_URL = `https://gitee.com/api/v5/repos/${GITEE_REPO}/releases?per_page=1`;
const RELEASES_PAGE_URL = `https://gitee.com/${GITEE_REPO}/releases`;
const REQUEST_HEADERS = {
    'User-Agent': 'War3ModelView-Updater',
    Accept: 'application/json',
};
const GITEE_RATE_LIMIT_ERROR = 'GITEE_RATE_LIMIT';

interface GiteeRelease {
    tag_name: string;
    body: string;
    assets: {
        name: string;
        browser_download_url: string;
    }[];
    created_at?: string;
}

function isGiteeRateLimitError(error: unknown): boolean {
    return error instanceof Error && error.message === GITEE_RATE_LIMIT_ERROR;
}

async function fetchLatestRelease(): Promise<GiteeRelease> {
    const response = await fetch(API_URL, { headers: REQUEST_HEADERS });
    if (response.ok) {
        return await response.json() as GiteeRelease;
    }

    const listResponse = await fetch(API_LIST_URL, { headers: REQUEST_HEADERS });
    if (listResponse.ok) {
        const list = await listResponse.json() as GiteeRelease[];
        const latest = list[0] ?? null;
        if (latest) {
            return latest;
        }
    }

    const status = listResponse.status || response.status;
    if (status === 403) {
        throw new Error(GITEE_RATE_LIMIT_ERROR);
    }

    throw new Error(`HTTP error! status: ${status}`);
}

// Version comparison: returns > 0 if v1 > v2
function parseVersionParts(version: string): number[] {
    const cleaned = version.replace(/^v/i, '');
    const matches = cleaned.match(/\d+/g);
    if (!matches || matches.length === 0) return [0];
    return matches.map((part) => Number.parseInt(part, 10));
}

function compareVersions(v1: string, v2: string): number {
    const p1 = parseVersionParts(v1);
    const p2 = parseVersionParts(v2);
    const len = Math.max(p1.length, p2.length);

    for (let i = 0; i < len; i++) {
        const n1 = p1[i] ?? 0;
        const n2 = p2[i] ?? 0;
        if (n1 > n2) return 1;
        if (n1 < n2) return -1;
    }
    return 0;
}

function isNewerVersion(current: string, remote: string): boolean {
    return compareVersions(remote, current) > 0;
}

async function downloadAndInstall(assets: GiteeRelease['assets'], version: string) {
    const loadingId = showMessage('loading', '正在更新', '正在下载安装包，请稍候...', 0);    const exeAsset = assets.find(a => a.name.endsWith('.exe'));
    if (!exeAsset) {
        console.error('[Update] No .exe asset found in release. Assets:', assets.map(a => a.name));
        useMessageStore.getState().removeMessage(loadingId);
        showMessage('error', '更新失败', '未找到可执行安装包。');
        return;
    }

    try {
        const downloadUrl = exeAsset.browser_download_url;
        const fileName = exeAsset.name;
        const tempDirPath = await tempDir();
        const absolutePath = `${tempDirPath}${fileName}`;       // Use Rust backend command to download - bypasses all JS HTTP/shell issues
        const { invoke } = await import('@tauri-apps/api/core');        await invoke('download_file', { url: downloadUrl, targetPath: absolutePath });        useMessageStore.getState().removeMessage(loadingId);
        showMessage('success', '下载完成', '即将启动安装程序...', 2000);        await invoke('launch_installer', { path: absolutePath });

        setTimeout(async () => {
            await exit(0);
        }, 1000);

    } catch (e) {
        console.error('Download/Install error:', e);
        useMessageStore.getState().removeMessage(loadingId);
        showMessage('error', '更新失败', `安装过程中出错: ${e}`);
    }
}

export async function checkGiteeUpdate() {
    const loadingId = showMessage('loading', '正在检查更新...', '请稍候...', 0);
    try {
        const currentVersion = await getVersion();
        const data = await fetchLatestRelease();
        const latestVersion = data.tag_name || (data as any).name || '';

        useMessageStore.getState().removeMessage(loadingId);

        if (isNewerVersion(currentVersion, latestVersion)) {
            const confirmed = await showConfirm(
                '发现新版本',
                <UpdateLogContent
                    version={latestVersion}
                    date={data.created_at ? data.created_at.split('T')[0] : new Date().toISOString().split('T')[0]}
                    body={data.body || '暂无更新说明'}
                />,
                600 // Wider modal
            );

            if (confirmed) {
                await downloadAndInstall(data.assets, latestVersion);
            }
        } else {
            // Version is the same - still show changelog
            await showConfirm(
                `已是最新版本 (${currentVersion})`,
                <UpdateLogContent
                    version={latestVersion}
                    date={data.created_at ? data.created_at.split('T')[0] : new Date().toISOString().split('T')[0]}
                    body={data.body || '暂无更新说明'}
                />,
                600
            );
        }
    } catch (error) {
        console.error('Update check failed:', error);
        useMessageStore.getState().removeMessage(loadingId);
        if (isGiteeRateLimitError(error)) {
            const shouldOpenReleasePage = await showConfirm(
                '更新检查过于频繁',
                'Gitee 更新接口当前触发了访问频率限制。点击确定打开发布页手动下载最新版本。',
                520
            );
            if (shouldOpenReleasePage) {
                await open(RELEASES_PAGE_URL);
            }
            return;
        }

        showMessage('error', '更新检查失败', String(error));
    }
}

export async function showChangelog() {
    const loadingId = showMessage('loading', '正在获取日志...', '请稍候...', 0);
    try {
        const data = await fetchLatestRelease();

        useMessageStore.getState().removeMessage(loadingId);

        // Use showConfirm to display the modal. 
        // We'll rely on the default "OK"/"Cancel" buttons which close the modal.
        // The user can just click OK to close.
        await showConfirm(
            '更新日志 (Update Log)',
            <UpdateLogContent
                version={data.tag_name || (data as any).name || ''}
                date={data.created_at ? data.created_at.split('T')[0] : ''}
                body={data.body || '暂无更新说明'}
            />,
            600
        );

    } catch (e) {
        useMessageStore.getState().removeMessage(loadingId);
        if (isGiteeRateLimitError(e)) {
            showMessage('error', '获取失败', 'Gitee 更新接口当前限流，请稍后重试。');
            return;
        }

        showMessage('error', '获取失败', '无法获取更新日志');
    }
}

export async function checkGiteeUpdateSilent() {
    try {
        const currentVersion = await getVersion();
        const data = await fetchLatestRelease();
        const latestVersion = data.tag_name || (data as any).name || '';

        if (isNewerVersion(currentVersion, latestVersion)) {
            const confirmed = await showConfirm(
                '发现新版本',
                <UpdateLogContent
                    version={latestVersion}
                    date={data.created_at ? data.created_at.split('T')[0] : new Date().toISOString().split('T')[0]}
                    body={data.body || '暂无更新说明'}
                />,
                600 // Wider modal
            );

            if (confirmed) {
                await downloadAndInstall(data.assets, latestVersion);
            }
        }
    } catch (error) {
        if (isGiteeRateLimitError(error)) {
            return;
        }
        console.error('Silent update check failed:', error);
    }
}
