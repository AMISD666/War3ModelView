import { addRecentFile, type RecentFile } from '../../services/historyService'
import { showMessage } from '../../store/messageStore'
import { retargetAnimationService } from './RetargetAnimationService'

interface OpenRetargetTargetPathsInput {
    paths: string[]
    addToRecent?: boolean
    acceptPath: (path: string) => boolean
    setRecentFiles: (files: RecentFile[]) => void
}

interface OpenRetargetTargetFromDialogInput {
    setRecentFiles: (files: RecentFile[]) => void
}

const getDisplayName = (path: string): string => path.split(/[\\/]/).pop() || path

export const openRetargetTargetPaths = async (input: OpenRetargetTargetPathsInput): Promise<string[]> => {
    const targetPaths = input.paths.filter(input.acceptPath)
    const openedPaths: string[] = []
    for (const path of targetPaths) {
        try {
            await retargetAnimationService.openTargetPath(path)
            openedPaths.push(path)
            if (input.addToRecent ?? true) {
                input.setRecentFiles(addRecentFile(path))
            }
        } catch (error) {
            console.error('[RetargetTargetOpen] Failed to open target model:', error)
            showMessage('error', '打开 B 区模型失败', error instanceof Error ? error.message : String(error))
        }
    }
    return openedPaths
}

export const openRetargetTargetFromDialog = async (input: OpenRetargetTargetFromDialogInput): Promise<boolean> => {
    const snapshot = await retargetAnimationService.openTargetFromDialog()
    if (!snapshot?.path) return false
    input.setRecentFiles(addRecentFile(snapshot.path))
    showMessage('success', '套动作模式', `B 区已打开: ${getDisplayName(snapshot.path)}`)
    return true
}
