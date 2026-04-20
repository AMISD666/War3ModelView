import { create } from 'zustand'
import {
    DEFAULT_GLOBAL_COLOR_ADJUST_SETTINGS,
    normalizeGlobalColorAdjustSettings,
    type GlobalColorAdjustSettings,
} from '../utils/globalColorAdjustCore'

interface GlobalColorAdjustStore {
    settings: GlobalColorAdjustSettings
    setSettings: (settings: Partial<GlobalColorAdjustSettings>) => void
    replaceSettings: (settings: Partial<GlobalColorAdjustSettings>) => void
    resetSettings: () => void
}

export const useGlobalColorAdjustStore = create<GlobalColorAdjustStore>()((set) => ({
    settings: DEFAULT_GLOBAL_COLOR_ADJUST_SETTINGS,
    setSettings: (settings) => set((state) => ({
        settings: normalizeGlobalColorAdjustSettings({
            ...state.settings,
            ...settings,
            targets: {
                ...state.settings.targets,
                ...settings.targets,
            },
        }),
    })),
    replaceSettings: (settings) => set({
        settings: normalizeGlobalColorAdjustSettings(settings),
    }),
    resetSettings: () => set({
        settings: DEFAULT_GLOBAL_COLOR_ADJUST_SETTINGS,
    }),
}))
