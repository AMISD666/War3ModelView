import { useCallback, useEffect, useState } from 'react'
import { desktopGateway } from '../../infrastructure/desktop'

const AUTO_UPDATE_CHECK_DATE_KEY = 'lastAutoUpdateCheck'
const DEBUG_CONSOLE_STORAGE_KEY = 'showDebugConsole'

export interface ActivationStatus {
    is_activated: boolean
    license_type: string
    expiration_date: string | null
    days_remaining: number | null
    level: number
    level_name: string
}

const getTodayKey = (): string => new Date().toISOString().split('T')[0]

const loadDebugConsolePreference = (): boolean => {
    try {
        const saved = localStorage.getItem(DEBUG_CONSOLE_STORAGE_KEY)
        return saved ? JSON.parse(saved) : false
    } catch {
        return false
    }
}

export const useAppShellController = () => {
    const [showAbout, setShowAbout] = useState(false)
    const [showDebugConsole, setShowDebugConsole] = useState(loadDebugConsolePreference)
    const [activationStatus, setActivationStatus] = useState<ActivationStatus | null>(null)
    const [activationCode, setActivationCode] = useState('')
    const [activationLoading, setActivationLoading] = useState(false)
    const [activationError, setActivationError] = useState<string | null>(null)

    useEffect(() => {
        localStorage.setItem(DEBUG_CONSOLE_STORAGE_KEY, JSON.stringify(showDebugConsole))
        void import('../../utils/debugConsoleState').then(({ setDebugConsoleEnabled }) => {
            setDebugConsoleEnabled(showDebugConsole)
        })
        desktopGateway.invoke('toggle_console', { show: showDebugConsole }).catch((error) => {
            console.error('Failed to toggle console:', error)
        })
    }, [showDebugConsole])

    const fetchActivationStatus = useCallback(async () => {
        try {
            const status = await desktopGateway.invoke<ActivationStatus>('get_activation_status')
            setActivationStatus(status)
        } catch (error) {
            console.error('Failed to get activation status:', error)
        }
    }, [])

    useEffect(() => {
        if (!showAbout) {
            return
        }

        void fetchActivationStatus()
        setActivationError(null)
    }, [fetchActivationStatus, showAbout])

    const checkUpdate = useCallback(async () => {
        localStorage.setItem(AUTO_UPDATE_CHECK_DATE_KEY, getTodayKey())
        const { checkGiteeUpdate } = await import('../../services/updateService')
        await checkGiteeUpdate()
    }, [])

    const showChangelog = useCallback(async () => {
        const { showChangelog: showChangelogDialog } = await import('../../services/updateService')
        await showChangelogDialog()
    }, [])

    useEffect(() => {
        let disposed = false

        const timeoutId = window.setTimeout(() => {
            const today = getTodayKey()
            if (localStorage.getItem(AUTO_UPDATE_CHECK_DATE_KEY) === today) {
                return
            }

            localStorage.setItem(AUTO_UPDATE_CHECK_DATE_KEY, today)
            void import('../../services/updateService').then(({ checkGiteeUpdateSilent }) => {
                if (!disposed) {
                    checkGiteeUpdateSilent()
                }
            })
        }, 1500)

        return () => {
            disposed = true
            window.clearTimeout(timeoutId)
        }
    }, [])

    const activate = useCallback(async () => {
        const trimmedCode = activationCode.trim()
        if (!trimmedCode) {
            setActivationError('请输入激活码')
            return
        }

        setActivationLoading(true)
        setActivationError(null)

        try {
            const result = await desktopGateway.invoke<ActivationStatus>('activate_software', {
                licenseCode: trimmedCode,
            })
            setActivationStatus(result)
            setActivationCode('')

            if (result.is_activated) {
                alert(`激活成功！\n\n版本: ${result.level_name}\n授权类型: ${result.license_type === 'PERM' ? '永久授权' : '时限授权'}`)
            }
        } catch (error: any) {
            setActivationError(typeof error === 'string' ? error : (error?.message || '激活失败'))
        } finally {
            setActivationLoading(false)
        }
    }, [activationCode])

    return {
        showAbout,
        setShowAbout,
        showDebugConsole,
        setShowDebugConsole,
        activationStatus,
        activationCode,
        setActivationCode,
        activationLoading,
        activationError,
        checkUpdate,
        showChangelog,
        activate,
    }
}
