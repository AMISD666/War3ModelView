export interface Command {
    execute(): void
    undo(): void
}

export class CommandManager {
    private history: Command[] = []
    private redoStack: Command[] = []
    private maxHistory: number = 50

    execute(command: Command) {
        command.execute()
        this.history.push(command)
        this.redoStack = [] // Clear redo stack on new action

        if (this.history.length > this.maxHistory) {
            this.history.shift()
        }
    }

    undo() {
        const command = this.history.pop()
        if (command) {
            command.undo()
            this.redoStack.push(command)
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

export const useCommandManager = () => {
    return {
        executeCommand: (cmd: Command) => commandManager.execute(cmd),
        undo: () => commandManager.undo(),
        redo: () => commandManager.redo()
    }
}
