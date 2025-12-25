import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { readFile } from 'fs/promises'
import icon from '../../resources/icon.png?asset'
import {
    registerContextMenu,
    unregisterContextMenu,
    isContextMenuRegistered,
    getFilePathFromArgs
} from './contextMenuManager'

// Simple isDev check
const isDev = process.env.NODE_ENV !== 'production'

// Global reference to main window
let mainWindow: BrowserWindow | null = null

function createWindow(): void {
    // Create the browser window.
    mainWindow = new BrowserWindow({
        width: 1440,
        height: 900,
        show: false,
        autoHideMenuBar: true,
        ...(process.platform === 'linux' ? { icon } : {}),
        webPreferences: {
            preload: join(__dirname, '../preload/index.js'),
            sandbox: false
        }
    })

    mainWindow.on('ready-to-show', () => {
        mainWindow?.show()

        // Check if app was opened with a file argument
        const filePath = getFilePathFromArgs()
        if (filePath) {
            // Wait a bit for renderer to initialize, then send the file path
            setTimeout(() => {
                mainWindow?.webContents.send('open-file-from-args', filePath)
            }, 500)
        }
    })

    mainWindow.webContents.setWindowOpenHandler((details) => {
        shell.openExternal(details.url)
        return { action: 'deny' }
    })

    mainWindow.on('closed', () => {
        mainWindow = null
    })

    // HMR for renderer base on electron-vite cli.
    // Load the remote URL for development or the local html file for production.
    if (isDev && process.env['ELECTRON_RENDERER_URL']) {
        mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
        mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
    }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
    // Set app user model id for windows
    if (process.platform === 'win32') {
        app.setAppUserModelId('com.war3model.editor')
    }

    createWindow()

    app.on('activate', function () {
        // On macOS it's common to re-create a window in the app when the
        // dock icon is clicked and there are no other windows open.
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
})

// Handle second instance (when opening file while app is already running)
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
    app.quit()
} else {
    app.on('second-instance', (_event, commandLine) => {
        // Someone tried to run a second instance, focus our window
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore()
            mainWindow.focus()

            // Check for file path in command line
            for (const arg of commandLine) {
                if (arg.endsWith('.mdx') || arg.endsWith('.mdl')) {
                    mainWindow.webContents.send('open-file-from-args', arg)
                    break
                }
            }
        }
    })
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit()
    }
})

// IPC Handlers for file operations
ipcMain.handle('dialog:openFile', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [
            { name: 'Warcraft 3 Models', extensions: ['mdx', 'mdl'] },
            { name: 'All Files', extensions: ['*'] }
        ]
    })
    if (canceled) {
        return null
    } else {
        return filePaths[0]
    }
})

ipcMain.handle('fs:readFile', async (_, path: string) => {
    const buffer = await readFile(path)
    return buffer
})

// Context Menu IPC Handlers
ipcMain.handle('context-menu:register', async () => {
    return await registerContextMenu()
})

ipcMain.handle('context-menu:unregister', async () => {
    return await unregisterContextMenu()
})

ipcMain.handle('context-menu:check-status', async () => {
    return await isContextMenuRegistered()
})
