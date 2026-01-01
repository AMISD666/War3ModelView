
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
    duration?: number; // ms, default 3000. 0 means no auto-dismiss.
}

interface MessageState {
    messages: Message[];
    addMessage: (message: Omit<Message, 'id'>) => string;
    removeMessage: (id: string) => void;
    clearAll: () => void;
}

export const useMessageStore = create<MessageState>((set) => ({
    messages: [],
    addMessage: (message) => {
        const id = Math.random().toString(36).substring(7);
        set((state) => ({
            messages: [...state.messages, { ...message, id }]
        }));
        return id;
    },
    removeMessage: (id) => set((state) => ({
        messages: state.messages.filter(m => m.id !== id)
    })),
    clearAll: () => set({ messages: [] })
}));

// Helper functions for imperative usage
export const showMessage = (type: MessageType, title: string, content: React.ReactNode, duration: number = 3000): void => {
    useMessageStore.getState().addMessage({
        type,
        title,
        content,
        duration
    });
};

export const showConfirm = (title: string, content: React.ReactNode): Promise<boolean> => {
    return new Promise((resolve) => {
        useMessageStore.getState().addMessage({
            type: 'confirm',
            title,
            content,
            onOk: () => resolve(true),
            onCancel: () => resolve(false)
        });
    });
};
