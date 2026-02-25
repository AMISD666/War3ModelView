import React, { useState, useEffect } from 'react';
import { Button } from 'antd';
import { CloseOutlined, MinusOutlined, PushpinOutlined, PushpinFilled } from '@ant-design/icons';
import { getCurrentWindow } from '@tauri-apps/api/window';

interface StandaloneWindowFrameProps {
    title: string | React.ReactNode;
    children: React.ReactNode;
    onClose?: () => void; // Optional custom close logic (like destroying the component), defaults to window.hide()
}

export const StandaloneWindowFrame: React.FC<StandaloneWindowFrameProps> = ({ title, children, onClose }) => {
    const [isPinned, setIsPinned] = useState(false);

    useEffect(() => {
        // We initialize the local state based on what we set, but to be 100% sure we could query the window if Tauri API allowed it synchronously.
        // For now, since Windows spawn with alwaysOnTop: false, we start at false.
        getCurrentWindow().setAlwaysOnTop(isPinned).catch(console.error);
    }, [isPinned]);

    const handleMinimize = async () => {
        try {
            await getCurrentWindow().minimize();
        } catch (e) {
            console.error('Failed to minimize window:', e);
        }
    };

    const handleTogglePin = () => {
        setIsPinned(!isPinned);
    };

    const handleClose = async () => {
        if (onClose) {
            onClose();
        } else {
            try {
                await getCurrentWindow().hide();
            } catch (e) {
                console.error('Failed to hide window:', e);
            }
        }
    };

    return (
        <div style={{
            width: '100vw',
            height: '100vh',
            backgroundColor: '#1e1e1e', // Standard Base
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
        }}>
            {/* Native Window Custom Title Bar Wrapper */}
            <div
                data-tauri-drag-region
                style={{
                    height: '36px', // Standard Height
                    minHeight: '36px',
                    backgroundColor: '#2c2c2c', // Standard Header Base
                    borderBottom: '1px solid #3a3a3a', // Standard Border
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0', // Adjust padding to let buttons align perfectly
                    userSelect: 'none',
                }}
            >
                <div
                    data-tauri-drag-region
                    style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'center', paddingLeft: '16px', cursor: 'default' }}
                >
                    <span data-tauri-drag-region style={{ color: '#e0e0e0', fontWeight: 600, fontSize: 13, pointerEvents: 'none' }}>
                        {title}
                    </span>
                </div>
                <div style={{ display: 'flex', height: '100%', alignItems: 'center' }}>
                    <Button
                        type="text"
                        onClick={handleTogglePin}
                        icon={isPinned ? <PushpinFilled style={{ fontSize: 14 }} /> : <PushpinOutlined style={{ fontSize: 14 }} />}
                        style={{
                            color: isPinned ? '#5a9cff' : '#888',
                            width: 40,
                            height: '100%',
                            borderRadius: 0,
                            display: 'flex',
                            justifyContent: 'center',
                            alignItems: 'center',
                            cursor: 'pointer',
                            zIndex: 100,
                            transition: 'all 0.2s'
                        }}
                        className="hover:!bg-[#3a3a3a] hover:!text-[#e0e0e0]"
                        title={isPinned ? "取消置顶" : "置顶窗口"}
                    />
                    <Button
                        type="text"
                        onClick={handleMinimize}
                        icon={<MinusOutlined style={{ fontSize: 14 }} />}
                        style={{
                            color: '#888',
                            width: 40,
                            height: '100%',
                            borderRadius: 0,
                            display: 'flex',
                            justifyContent: 'center',
                            alignItems: 'center',
                            cursor: 'pointer',
                            zIndex: 100,
                            transition: 'all 0.2s'
                        }}
                        className="hover:!bg-[#3a3a3a] hover:!text-[#e0e0e0]"
                        title="最小化"
                    />
                    <Button
                        type="text"
                        onClick={handleClose}
                        icon={<CloseOutlined style={{ fontSize: 14 }} />}
                        style={{
                            color: '#888',
                            width: 40,
                            height: '100%',
                            borderRadius: 0,
                            display: 'flex',
                            justifyContent: 'center',
                            alignItems: 'center',
                            cursor: 'pointer',
                            zIndex: 100,
                            transition: 'all 0.2s'
                        }}
                        className="hover:!text-white hover:!bg-[#e81123]"
                        title="关闭"
                    />
                </div>
            </div>
            {/* Content Wrapper */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                {children}
            </div>
        </div>
    );
};
