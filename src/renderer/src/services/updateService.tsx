
import React from 'react';
import { showMessage, showConfirm, useMessageStore } from '../store/messageStore';
import { getVersion } from '@tauri-apps/api/app';
import { fetch } from '@tauri-apps/plugin-http';
import { tempDir } from '@tauri-apps/api/path';
import { open } from '@tauri-apps/plugin-shell';
import { writeFile } from '@tauri-apps/plugin-fs';
import { exit } from '@tauri-apps/plugin-process';
import { UpdateLogContent } from '../components/UpdateLogContent';

const GITEE_REPO = 'AMISD666/gg-war3-model-edit';
const API_URL = `https://gitee.com/api/v5/repos/${GITEE_REPO}/releases/latest`;

interface GiteeRelease {
    tag_name: string;
    body: string;
    assets: {
        name: string;
        browser_download_url: string;
    }[];
    created_at?: string;
}

// Version comparison: returns > 0 if v1 > v2
function compareVersions(v1: string, v2: string): number {
    const p1 = v1.replace(/^v/, '').split('.').map(Number);
    const p2 = v2.replace(/^v/, '').split('.').map(Number);
    const len = Math.max(p1.length, p2.length);

    for (let i = 0; i < len; i++) {
        const n1 = p1[i] || 0;
        const n2 = p2[i] || 0;
        if (n1 > n2) return 1;
        if (n1 < n2) return -1;
    }
    return 0;
}

function isNewerVersion(current: string, remote: string): boolean {
    return compareVersions(remote, current) > 0;
}

async function downloadAndInstall(assets: GiteeRelease['assets'], version: string) {
    const loadingId = showMessage('loading', '正在更新', '正在下载安装包，请稍候...', 0);

    // Debug: Log all assets
    console.log('[Update] Available assets:', assets);

    const exeAsset = assets.find(a => a.name.endsWith('.exe'));
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
        const absolutePath = `${tempDirPath}${fileName}`;

        console.log('[Update] Download URL:', downloadUrl);
        console.log('[Update] Target path:', absolutePath);

        // Use Rust backend command to download - bypasses all JS HTTP/shell issues
        const { invoke } = await import('@tauri-apps/api/core');

        console.log('[Update] Invoking Rust download_file command...');

        await invoke('download_file', { url: downloadUrl, targetPath: absolutePath });

        console.log('[Update] Download completed successfully');

        useMessageStore.getState().removeMessage(loadingId);
        showMessage('success', '下载完成', '即将启动安装程序...', 2000);

        console.log(`[Update] executing installer at: ${absolutePath}`);
        await invoke('launch_installer', { path: absolutePath });

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
        const response = await fetch(API_URL);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json() as GiteeRelease;
        const latestVersion = data.tag_name;

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
                    version={data.tag_name}
                    date={data.created_at ? data.created_at.split('T')[0] : new Date().toISOString().split('T')[0]}
                    body={data.body || '暂无更新说明'}
                />,
                600
            );
        }
    } catch (error) {
        console.error('Update check failed:', error);
        useMessageStore.getState().removeMessage(loadingId);
        showMessage('error', '更新检查失败', String(error));
    }
}

export async function showChangelog() {
    const loadingId = showMessage('loading', '正在获取日志...', '请稍候...', 0);
    try {
        const response = await fetch(API_URL);
        if (!response.ok) throw new Error('Fetch failed');
        const data = await response.json() as GiteeRelease;

        useMessageStore.getState().removeMessage(loadingId);

        // Use showConfirm to display the modal. 
        // We'll rely on the default "OK"/"Cancel" buttons which close the modal.
        // The user can just click OK to close.
        await showConfirm(
            '更新日志 (Update Log)',
            <UpdateLogContent
                version={data.tag_name}
                date={data.created_at ? data.created_at.split('T')[0] : ''}
                body={data.body || '暂无更新说明'}
            />,
            600
        );

    } catch (e) {
        useMessageStore.getState().removeMessage(loadingId);
        showMessage('error', '获取失败', '无法获取更新日志');
    }
}

export async function checkGiteeUpdateSilent() {
    try {
        const currentVersion = await getVersion();
        const response = await fetch(API_URL);

        if (!response.ok) {
            return; // Silent failure
        }

        const data = await response.json() as GiteeRelease;
        const latestVersion = data.tag_name;

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
        console.error('Silent update check failed:', error);
    }
}
