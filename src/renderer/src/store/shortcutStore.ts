import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { appDirStorage } from '../utils/persistStorage'
import { shortcutActions } from '../shortcuts/actions'

interface ShortcutState {
    bindings: Record<string, string[]>
    setBindings: (actionId: string, bindings: string[]) => void
    clearBindings: (actionId: string) => void
    resetAll: () => void
}

const defaultBindingsMap = new Map(
    shortcutActions.map((action) => [action.id, action.defaultBindings])
)

export const getDefaultBindings = (actionId: string): string[] => {
    return defaultBindingsMap.get(actionId) ?? []
}

export const useShortcutStore = create<ShortcutState>()(
    persist(
        (set) => ({
            bindings: {},
            setBindings: (actionId, bindings) =>
                set((state) => ({
                    bindings: { ...state.bindings, [actionId]: bindings }
                })),
            clearBindings: (actionId) =>
                set((state) => {
                    const next = { ...state.bindings }
                    delete next[actionId]
                    return { bindings: next }
                }),
            resetAll: () => set({ bindings: {} })
        }),
        {
            name: 'shortcut-settings-v1',
            storage: appDirStorage,
            partialize: (state) => ({
                bindings: state.bindings
            })
        }
    )
)
