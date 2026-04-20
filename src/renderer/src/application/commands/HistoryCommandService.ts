import { useHistoryStore } from '../../store/historyStore'

export class HistoryCommandService {
    clear(): void {
        useHistoryStore.getState().clear()
    }

    markSaved(): void {
        useHistoryStore.getState().markSaved()
    }

    undo(): void {
        useHistoryStore.getState().undo()
    }

    redo(): void {
        useHistoryStore.getState().redo()
    }
}

export const historyCommandService = new HistoryCommandService()
