
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

// Helper functions for imperative usage
export const showMessage = (type: MessageType, title: string, content: React.ReactNode, duration: number = 3000): string => {
    return useMessageStore.getState().addMessage({
        type,
        title,
        content,
        duration
    });
};

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
