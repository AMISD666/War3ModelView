
import { create } from 'zustand';

export type MessageType = 'info' | 'success' | 'warning' | 'error' | 'confirm' | 'loading';

export interface Message {
    id: string;
    type: MessageType;
    title: string;
    content: React.ReactNode;
    onOk?: () => void;
    onCancel?: () => void;
    okText?: string;
    cancelText?: string;
    footer?: React.ReactNode | null;
    duration?: number; // ms, default 3000. 0 means no auto-dismiss.
    width?: number;
}

interface MessageState {
    messages: Message[];
    addMessage: (msg: Omit<Message, 'id'>) => string;
    removeMessage: (id: string) => void;
    clearAll: () => void;
}

export const useMessageStore = create<MessageState>((set) => ({
    messages: [],
    addMessage: (msg) => {
        const id = Math.random().toString(36).substring(2, 9);
        set((state) => ({
            messages: [...state.messages, { ...msg, id }]
        }));
        // Auto remove if duration > 0
        if (msg.duration !== 0) {
            setTimeout(() => {
                set((state) => ({
                    messages: state.messages.filter((m) => m.id !== id)
                }));
            }, msg.duration || 3000);
        }
        return id;
    },
    removeMessage: (id) =>
        set((state) => ({
            messages: state.messages.filter((m) => m.id !== id)
        })),
    clearAll: () => set({ messages: [] })
}));

// Helper functions for imperative usage.
// Legacy code still calls showMessage(content, type); keep that shape temporarily while call sites are cleaned up.
export function showMessage(type: MessageType, title: string, content: React.ReactNode, duration?: number): string;
export function showMessage(content: React.ReactNode, type: MessageType): string;
export function showMessage(
    arg1: MessageType | React.ReactNode,
    arg2: string | MessageType,
    arg3?: React.ReactNode,
    arg4: number = 3000
): string {
    if (
        arg3 === undefined &&
        typeof arg2 === 'string' &&
        ['info', 'success', 'warning', 'error', 'confirm', 'loading'].includes(arg2)
    ) {
        return useMessageStore.getState().addMessage({
            type: arg2 as MessageType,
            title: typeof arg1 === 'string' ? arg1 : '提示',
            content: arg1,
            duration: arg4
        });
    }

    return useMessageStore.getState().addMessage({
        type: arg1 as MessageType,
        title: String(arg2),
        content: arg3,
        duration: arg4
    });
}

export const showConfirm = (title: string, content: React.ReactNode, width?: number): Promise<boolean> => {
    return new Promise((resolve) => {
        useMessageStore.getState().addMessage({
            type: 'confirm',
            title,
            content,
            width,
            duration: 0, // Confirm dialogs should not auto-dismiss
            onOk: () => resolve(true),
            onCancel: () => resolve(false)
        });
    });
};
