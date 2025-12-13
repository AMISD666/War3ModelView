export interface Command {
    execute(): void
    undo(): void
}

export class CommandManager {
    private history: Command[] = []
    private redoStack: Command[] = []
    private maxHistory: number = 50

    execute(command: Command) {
        console.log('[CommandManager] Executing command', command.constructor.name)
        command.execute()
        this.history.push(command)
        this.redoStack = [] // Clear redo stack on new action
        console.log('[CommandManager] History length:', this.history.length)

        if (this.history.length > this.maxHistory) {
            this.history.shift()
        }
    }

    undo() {
        console.log('[CommandManager] Undo called. History length:', this.history.length)
        const command = this.history.pop()
        if (command) {
            console.log('[CommandManager] Undoing command', command.constructor.name)
            command.undo()
            this.redoStack.push(command)
        } else {
            console.warn('[CommandManager] Nothing to undo')
        }
    }

    redo() {
        const command = this.redoStack.pop()
        if (command) {
            command.execute()
            this.history.push(command)
        }
    }

    clear() {
        this.history = []
        this.redoStack = []
    }
}

export const commandManager = new CommandManager()
