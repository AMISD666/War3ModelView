import { useHistoryStore } from '../../store/historyStore'
import { validateDocumentReferencesAfterCommand } from './CommandIntegrityGuard'

export interface DocumentCommand {
    name: string
    execute(): void
    undo(): void
    redo?(): void
}

export interface ExecuteDocumentCommandOptions {
    recordHistory?: boolean
    validateDocumentReferences?: boolean
}

export class CommandBus {
    execute(command: DocumentCommand, options: ExecuteDocumentCommandOptions = {}): void {
        const recordHistory = options.recordHistory ?? true
        const validateAfterCommand = options.validateDocumentReferences ?? true
        command.execute()
        if (validateAfterCommand) {
            validateDocumentReferencesAfterCommand(command.name, 'execute')
        }

        if (!recordHistory) {
            return
        }

        useHistoryStore.getState().push({
            name: command.name,
            undo: () => {
                command.undo()
                if (validateAfterCommand) {
                    validateDocumentReferencesAfterCommand(command.name, 'undo')
                }
            },
            redo: () => {
                if (command.redo) {
                    command.redo()
                } else {
                    command.execute()
                }
                if (validateAfterCommand) {
                    validateDocumentReferencesAfterCommand(command.name, 'redo')
                }
            },
        })
    }
}

export const commandBus = new CommandBus()
