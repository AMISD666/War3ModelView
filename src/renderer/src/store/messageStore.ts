
import { create } from 'zustand';

export type MessageType = 'info' | 'success' | 'warning' | 'error' | 'confirm' | 'loading';
export type MessageKey = string | number;
interface MessageButtonProps {
    danger?: boolean;
}

export interface Message {
    id: string;
    key?: MessageKey;
    type: MessageType;
    title: string;
    content: React.ReactNode;
    onOk?: () => void;
    onCancel?: () => void;
    onExtra?: () => void;
    okText?: string;
    cancelText?: string;
    extraText?: string;
    okButtonProps?: MessageButtonProps;
    cancelButtonProps?: MessageButtonProps;
    extraButtonProps?: MessageButtonProps;
    footer?: React.ReactNode | null;
    duration?: number; // ms, default 3000. 0 means no auto-dismiss.
    width?: number;
}

interface MessageState {
    messages: Message[];
    addMessage: (msg: Omit<Message, 'id'>) => string;
    removeMessage: (idOrKey: string) => void;
    clearAll: () => void;
}

const activeTimers = new Map<string, number>();

const scheduleAutoRemove = (id: string, duration?: number) => {
    const existingTimer = activeTimers.get(id);
    if (existingTimer !== undefined) {
        window.clearTimeout(existingTimer);
        activeTimers.delete(id);
    }

    if (duration === 0) {
        return;
    }

    const timer = window.setTimeout(() => {
        activeTimers.delete(id);
        useMessageStore.setState((state) => ({
            messages: state.messages.filter((m) => m.id !== id)
        }));
    }, duration || 3000);
    activeTimers.set(id, timer);
};

export const useMessageStore = create<MessageState>((set) => ({
    messages: [],
    addMessage: (msg) => {
        const id = msg.key !== undefined ? String(msg.key) : Math.random().toString(36).substring(2, 9);
        set((state) => ({
            messages: [...state.messages.filter((m) => m.id !== id), { ...msg, id }]
        }));
        scheduleAutoRemove(id, msg.duration);
        return id;
    },
    removeMessage: (idOrKey) => {
        const timer = activeTimers.get(idOrKey);
        if (timer !== undefined) {
            window.clearTimeout(timer);
            activeTimers.delete(idOrKey);
        }
        set((state) => ({
            messages: state.messages.filter((m) => m.id !== idOrKey && String(m.key) !== idOrKey)
        }));
    },
    clearAll: () => {
        activeTimers.forEach((timer) => window.clearTimeout(timer));
        activeTimers.clear();
        set({ messages: [] });
    }
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

export type SaveDiscardCancelChoice = 'save' | 'discard' | 'cancel';

export const showSaveDiscardCancel = (
    title: string,
    content: React.ReactNode,
    width?: number
): Promise<SaveDiscardCancelChoice> => {
    return new Promise((resolve) => {
        useMessageStore.getState().addMessage({
            type: 'confirm',
            title,
            content,
            width,
            duration: 0,
            okText: '保存',
            cancelText: '取消',
            extraText: '不保存',
            extraButtonProps: { danger: true },
            onOk: () => resolve('save'),
            onCancel: () => resolve('cancel'),
            onExtra: () => resolve('discard')
        });
    });
};

export const showDiscardConfirm = (
    title: string,
    content: React.ReactNode,
    width?: number
): Promise<boolean> => {
    return new Promise((resolve) => {
        useMessageStore.getState().addMessage({
            type: 'confirm',
            title,
            content,
            width,
            duration: 0,
            okText: '不保存',
            cancelText: '取消',
            okButtonProps: { danger: true },
            onOk: () => resolve(true),
            onCancel: () => resolve(false)
        });
    });
};

interface AppMessageConfig {
    content: React.ReactNode;
    key?: MessageKey;
    duration?: number;
    type?: MessageType;
    onClose?: () => void;
}

interface AppConfirmConfig {
    title?: React.ReactNode;
    content?: React.ReactNode;
    okText?: string;
    cancelText?: string;
    width?: number;
    okButtonProps?: MessageButtonProps;
    cancelButtonProps?: MessageButtonProps;
    extraText?: string;
    extraButtonProps?: MessageButtonProps;
    centered?: boolean;
    className?: string;
    onOk?: () => void | Promise<void>;
    onCancel?: () => void;
    onExtra?: () => void;
}

const isMessageConfig = (value: unknown): value is AppMessageConfig => {
    return !!value && typeof value === 'object' && 'content' in value;
};

const showAppMessage = (
    type: MessageType,
    input: React.ReactNode | AppMessageConfig,
    duration?: number
): string => {
    const config = isMessageConfig(input)
        ? input
        : { content: input, duration };
    const messageDuration = config.duration ?? (type === 'loading' ? 0 : duration ?? 3000);

    return useMessageStore.getState().addMessage({
        key: config.key,
        type,
        title: '提示',
        content: config.content,
        duration: messageDuration,
        onCancel: config.onClose
    });
};

export const appMessage = {
    success: (input: React.ReactNode | AppMessageConfig, duration?: number) => showAppMessage('success', input, duration),
    warning: (input: React.ReactNode | AppMessageConfig, duration?: number) => showAppMessage('warning', input, duration),
    error: (input: React.ReactNode | AppMessageConfig, duration?: number) => showAppMessage('error', input, duration),
    info: (input: React.ReactNode | AppMessageConfig, duration?: number) => showAppMessage('info', input, duration),
    loading: (input: React.ReactNode | AppMessageConfig, duration?: number) => showAppMessage('loading', input, duration),
    open: (config: AppMessageConfig) => showAppMessage(config.type || 'info', config, config.duration),
    destroy: (key?: MessageKey) => {
        if (key === undefined) {
            useMessageStore.getState().clearAll();
            return;
        }
        useMessageStore.getState().removeMessage(String(key));
    }
};

export const appModal = {
    confirm: (config: AppConfirmConfig) => {
        const id = useMessageStore.getState().addMessage({
            type: 'confirm',
            title: typeof config.title === 'string' ? config.title : '确认',
            content: config.content,
            width: config.width,
            okText: config.okText,
            cancelText: config.cancelText,
            okButtonProps: config.okButtonProps,
            cancelButtonProps: config.cancelButtonProps,
            extraText: config.extraText,
            extraButtonProps: config.extraButtonProps,
            duration: 0,
            onOk: () => {
                void config.onOk?.();
            },
            onCancel: config.onCancel,
            onExtra: config.onExtra
        });

        return {
            destroy: () => useMessageStore.getState().removeMessage(id)
        };
    }
};
