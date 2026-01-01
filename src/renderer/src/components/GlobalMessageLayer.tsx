
import React, { useEffect, useState } from 'react';
import { DraggableModal } from './DraggableModal';
import { useMessageStore } from '../store/messageStore';
import { Button } from 'antd';
import { InfoCircleOutlined, CheckCircleFilled, ExclamationCircleFilled, CloseCircleFilled, QuestionCircleOutlined, LoadingOutlined } from '@ant-design/icons';

// --- Icons ---
const MessageIcon: React.FC<{ type: string }> = ({ type }) => {
    const style = { fontSize: '20px', marginRight: '10px' };
    switch (type) {
        case 'success': return <CheckCircleFilled style={{ ...style, color: '#52c41a' }} />;
        case 'warning': return <ExclamationCircleFilled style={{ ...style, color: '#faad14' }} />;
        case 'error': return <CloseCircleFilled style={{ ...style, color: '#ff4d4f' }} />;
        case 'confirm': return <QuestionCircleOutlined style={{ ...style, color: '#1890ff' }} />;
        case 'loading': return <LoadingOutlined style={{ ...style, color: '#1890ff' }} />;
        default: return <InfoCircleOutlined style={{ ...style, color: '#1890ff' }} />;
    }
};

// --- Toast Component ---
const Toast: React.FC<{ msg: any; onClose: () => void }> = ({ msg, onClose }) => {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        // Animation in
        requestAnimationFrame(() => setVisible(true));

        // Auto dismiss logic
        if (msg.duration !== 0 && msg.type !== 'loading') { // Default duration handled in store or here. Store has it now.
            const timer = setTimeout(() => {
                setVisible(false);
                setTimeout(onClose, 300); // Wait for animation out
            }, msg.duration || 3000);
            return () => clearTimeout(timer);
        }
    }, [msg, onClose]);

    return (
        <div
            style={{
                pointerEvents: 'auto',
                backgroundColor: '#fff',
                borderRadius: '4px',
                boxShadow: '0 3px 6px -4px rgba(0, 0, 0, 0.12), 0 6px 16px 0 rgba(0, 0, 0, 0.08), 0 9px 28px 8px rgba(0, 0, 0, 0.05)',
                padding: '10px 16px',
                display: 'flex',
                alignItems: 'center',
                marginBottom: '10px',
                opacity: visible ? 1 : 0,
                transform: visible ? 'translateY(0)' : 'translateY(-20px)',
                transition: 'opacity 0.3s, transform 0.3s',
                minWidth: '200px',
                maxWidth: '400px',
                color: 'rgba(0, 0, 0, 0.85)',
                fontSize: '14px',
                border: '1px solid #f0f0f0'
            }}
        >
            <MessageIcon type={msg.type} />
            <span style={{ fontWeight: 500 }}>{msg.content}</span>
        </div>
    );
};

// --- Main Layer ---
export const GlobalMessageLayer: React.FC = () => {
    const { messages, removeMessage } = useMessageStore();

    const confirmMessages = messages.filter(m => m.type === 'confirm');
    const toastMessages = messages.filter(m => m.type !== 'confirm');

    return (
        <>
            {/* Modal Layer (Confirms) */}
            {confirmMessages.map((msg) => {
                const handleClose = () => {
                    removeMessage(msg.id);
                    if (msg.onCancel) msg.onCancel();
                };

                const handleOk = () => {
                    removeMessage(msg.id);
                    if (msg.onOk) msg.onOk();
                };

                return (
                    <DraggableModal
                        key={msg.id}
                        title={msg.title}
                        open={true}
                        width={400}
                        onCancel={handleClose}
                        footer={
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                                <Button onClick={handleClose}>{msg.cancelText || '取消'}</Button>
                                <Button type="primary" onClick={handleOk}>
                                    {msg.okText || '确定'}
                                </Button>
                            </div>
                        }
                        wrapClassName="message-modal"
                        minWidth={300}
                        minHeight={150}
                    >
                        <div style={{ display: 'flex', alignItems: 'flex-start', width: '100%', padding: '24px' }}>
                            <div style={{ flexShrink: 0 }}>
                                <MessageIcon type={msg.type} />
                            </div>
                            <div style={{ flex: 1, paddingTop: 2, color: '#e8e8e8' }}>
                                {msg.content}
                            </div>
                        </div>
                    </DraggableModal>
                );
            })}

            {/* Toast Layer (Others) */}
            <div
                style={{
                    position: 'fixed',
                    top: '20px',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    zIndex: 9999, // Ensure on top of almost everything
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    pointerEvents: 'none', // pass clicks through empty space
                }}
            >
                {toastMessages.map(msg => (
                    <Toast
                        key={msg.id}
                        msg={msg}
                        onClose={() => {
                            removeMessage(msg.id);
                            if (msg.onCancel) msg.onCancel(); // technically no cancel for toast but for consistency
                        }}
                    />
                ))}
            </div>
        </>
    );
};
