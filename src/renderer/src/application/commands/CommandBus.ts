import { useHistoryStore } from '../../store/historyStore'

export interface DocumentCommand {
    name: string
    execute(): void
    undo(): void
    redo?(): void
}

export interface ExecuteDocumentCommandOptions {
    recordHistory?: boolean
}

export class CommandBus {
    execute(command: DocumentCommand, options: ExecuteDocumentCommandOptions = {}): void {
        const recordHistory = options.recordHistory ?? true
        command.execute()

        if (!recordHistory) {
            return
        }

        useHistoryStore.getState().push({
            name: command.name,
            undo: () => command.undo(),
            redo: () => {
                if (command.redo) {
                    command.redo()
                    return
                }
                command.execute()
            },
        })
    }
}

export const commandBus = new CommandBus()
