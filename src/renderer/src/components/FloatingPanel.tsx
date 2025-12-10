import React, { useRef, useState, useCallback, useEffect } from 'react';
import { Button } from 'antd';
import { CloseOutlined } from '@ant-design/icons';

interface FloatingPanelProps {
    open: boolean;
    onClose: () => void;
    onOk?: () => void;
    title: React.ReactNode;
    children: React.ReactNode;
    width?: number | string;
    height?: number | string;
    okText?: string;
    cancelText?: string;
    footer?: React.ReactNode | null;
    initialPosition?: { x: number; y: number };
}

/**
 * FloatingPanel - A truly independent draggable panel that doesn't block other panels
 * This replaces Ant Design Modal which has inherent blocking behavior
 */
export const FloatingPanel: React.FC<FloatingPanelProps> = ({
    open,
    onClose,
    onOk,
    title,
    children,
    width = 600,
    height = 'auto',
    okText = '确定',
    cancelText = '取消',
    footer,
    initialPosition
}) => {
    const panelRef = useRef<HTMLDivElement>(null);
    const [position, setPosition] = useState({ x: initialPosition?.x ?? 100, y: initialPosition?.y ?? 50 });
    const [size, setSize] = useState({ width: typeof width === 'number' ? width : 600, height: height });
    const [isDragging, setIsDragging] = useState(false);
    const [isResizing, setIsResizing] = useState(false);
    const dragStartPos = useRef({ x: 0, y: 0, panelX: 0, panelY: 0 });
    const resizeStartPos = useRef({ x: 0, y: 0, width: 0, height: 0 });
    const [zIndex, setZIndex] = useState(1000);

    // Increment global z-index counter to bring panel to front on click
    const bringToFront = useCallback(() => {
        setZIndex((FloatingPanel as any).zCounter = ((FloatingPanel as any).zCounter || 1000) + 1);
    }, []);

    useEffect(() => {
        if (open) {
            bringToFront();
            // Center panel on open if no initial position
            if (!initialPosition) {
                const x = Math.max(50, (window.innerWidth - (typeof width === 'number' ? width : 600)) / 2);
                const y = Math.max(50, window.innerHeight * 0.1);
                setPosition({ x, y });
            }
        }
    }, [open, initialPosition, width, bringToFront]);

    const handleDragStart = useCallback((e: React.MouseEvent) => {
        if ((e.target as HTMLElement).closest('.floating-panel-content')) return;
        e.preventDefault();
        setIsDragging(true);
        bringToFront();
        dragStartPos.current = { x: e.clientX, y: e.clientY, panelX: position.x, panelY: position.y };
    }, [position, bringToFront]);

    const handleResizeStart = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsResizing(true);
        bringToFront();
        const rect = panelRef.current?.getBoundingClientRect();
        resizeStartPos.current = {
            x: e.clientX,
            y: e.clientY,
            width: rect?.width || 600,
            height: rect?.height || 400
        };
    }, [bringToFront]);

    useEffect(() => {
        if (!isDragging && !isResizing) return;

        const handleMouseMove = (e: MouseEvent) => {
            if (isDragging) {
                const deltaX = e.clientX - dragStartPos.current.x;
                const deltaY = e.clientY - dragStartPos.current.y;
                setPosition({
                    x: Math.max(0, dragStartPos.current.panelX + deltaX),
                    y: Math.max(0, dragStartPos.current.panelY + deltaY)
                });
            } else if (isResizing) {
                const deltaX = e.clientX - resizeStartPos.current.x;
                const deltaY = e.clientY - resizeStartPos.current.y;
                setSize({
                    width: Math.max(300, resizeStartPos.current.width + deltaX),
                    height: Math.max(200, resizeStartPos.current.height + deltaY)
                });
            }
        };

        const handleMouseUp = () => {
            setIsDragging(false);
            setIsResizing(false);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging, isResizing]);

    if (!open) return null;

    const defaultFooter = footer === undefined ? (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={onClose}>{cancelText}</Button>
            {onOk && <Button type="primary" onClick={onOk}>{okText}</Button>}
        </div>
    ) : footer;

    return (
        <div
            ref={panelRef}
            className="floating-panel"
            style={{
                position: 'fixed',
                left: position.x,
                top: position.y,
                width: size.width,
                height: typeof size.height === 'number' ? size.height : undefined,
                zIndex,
                display: 'flex',
                flexDirection: 'column',
                backgroundColor: '#333',
                borderRadius: 8,
                boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
                border: '1px solid #444',
                overflow: 'hidden'
            }}
            onMouseDown={bringToFront}
        >
            {/* Header - Draggable */}
            <div
                className="floating-panel-header"
                onMouseDown={handleDragStart}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 16px',
                    backgroundColor: '#2a2a2a',
                    cursor: 'move',
                    userSelect: 'none',
                    borderBottom: '1px solid #444'
                }}
            >
                <span style={{ color: '#fff', fontWeight: 500 }}>{title}</span>
                <Button
                    type="text"
                    size="small"
                    onClick={onClose}
                    style={{ color: '#ff4d4f' }}
                    icon={<CloseOutlined />}
                />
            </div>

            {/* Content */}
            <div
                className="floating-panel-content"
                style={{
                    flex: 1,
                    overflow: 'auto',
                    padding: 16,
                    backgroundColor: '#2d2d2d',
                    color: '#e8e8e8'
                }}
            >
                {children}
            </div>

            {/* Footer */}
            {defaultFooter && (
                <div
                    className="floating-panel-footer"
                    style={{
                        padding: '10px 16px',
                        backgroundColor: '#333',
                        borderTop: '1px solid #444'
                    }}
                >
                    {defaultFooter}
                </div>
            )}

            {/* Resize Handle */}
            <div
                onMouseDown={handleResizeStart}
                style={{
                    position: 'absolute',
                    right: 0,
                    bottom: 0,
                    width: 16,
                    height: 16,
                    cursor: 'se-resize',
                    background: 'linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.3) 50%)',
                    borderBottomRightRadius: 8
                }}
            />
        </div>
    );
};

export default FloatingPanel;
