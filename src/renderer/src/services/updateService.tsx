
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

    const exeAsset = assets.find(a => a.name.endsWith('.exe'));
    if (!exeAsset) {
        console.error('[Update] No .exe asset found in release.');
        useMessageStore.getState().removeMessage(loadingId);
        showMessage('error', '更新失败', '未找到可执行安装包。');
        return;
    }

    try {
        // ENCODE THE URL to avoid "String contains non ISO-8859-1 code point" error in Headers if fetch uses it internally
        // Gitee URLs often contain Chinese characters in filenames
        const downloadUrl = encodeURI(exeAsset.browser_download_url);
        const fileName = exeAsset.name;
        // const tempPath = await tempDir(); 
        // tempDir() returns path with trailing slash on Windows usually, but let's be safe.
        // Actually writeFile with baseDir: 1 writes relative to temp.

        const binResponse = await fetch(downloadUrl, {
            method: 'GET',
            // Explicitly set empty headers to avoid any auto-inference issues, though usually not needed
        });
        if (!binResponse.ok) throw new Error(`Download failed: ${binResponse.status} ${binResponse.statusText}`);

        const blob = await binResponse.blob();
        const arrayBuffer = await blob.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);

        await writeFile(fileName, uint8Array, { baseDir: 1 }); // 1 = Temp

        useMessageStore.getState().removeMessage(loadingId);
        showMessage('success', '下载完成', '即将启动安装程序...', 2000);

        const tempDirPath = await tempDir();
        const absolutePath = `${tempDirPath}${fileName}`;

        console.log(`[Update] executing installer at: ${absolutePath}`);
        await open(absolutePath);

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
            showMessage('success', '已是最新版本', `当前版本 ${currentVersion} 已是最新`);
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
