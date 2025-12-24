import { useHistoryStore } from '../store/historyStore'

export interface Command {
    execute(): void
    undo(): void
    // Optional name for display in history list
    name?: string
}

export class CommandManager {
    // We strictly proxy to the global HistoryStore
    // The local arrays are removed to avoid dual sources of truth

    execute(command: Command) {
        // 1. Execute the command immediately (Action)
        command.execute()

        // 2. Push to history store (provides Undo/Redo capability)
        // Wrapper adapts the Command interface to the HistoryItem interface
        useHistoryStore.getState().push({
            name: command.name || command.constructor.name || 'Unknown Command',
            undo: () => command.undo(),
            redo: () => command.execute()
        })
    }

    undo() {
        useHistoryStore.getState().undo()
    }

    redo() {
        useHistoryStore.getState().redo()
    }

    clear() {
        useHistoryStore.getState().clear()
    }
}

export const commandManager = new CommandManager()

export const useCommandManager = () => {
    return {
        executeCommand: (cmd: Command) => commandManager.execute(cmd),
        undo: () => commandManager.undo(),
        redo: () => commandManager.redo()
    }
}
