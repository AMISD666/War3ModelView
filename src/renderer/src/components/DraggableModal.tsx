import React, { useRef, useState, useCallback, useEffect } from 'react';
import { Button } from 'antd';
import { CloseOutlined } from '@ant-design/icons';
import type { ModalProps } from 'antd/es/modal';

interface DraggableModalProps extends Omit<ModalProps, 'visible'> {
    children: React.ReactNode;
    resizable?: boolean;
    minWidth?: number;
    minHeight?: number;
}

/**
 * DraggableModal - Now uses a custom floating panel that doesn't block other panels
 * This replaces Ant Design Modal which has inherent blocking behavior
 */
export const DraggableModal: React.FC<DraggableModalProps> = ({
    resizable = true,
    minWidth = 300,
    minHeight = 200,
    open,
    onCancel,
    onOk,
    title,
    children,
    width = 600,
    footer,
    okText = '确定',
    cancelText = '取消',
    wrapClassName,
    ...restProps
}) => {
    const panelRef = useRef<HTMLDivElement>(null);
    const [position, setPosition] = useState<{ x: number, y: number } | null>(null);
    const [size, setSize] = useState({
        width: typeof width === 'number' ? width : 600,
        height: 'auto' as number | 'auto'
    });
    const [isDragging, setIsDragging] = useState(false);
    const [isResizing, setIsResizing] = useState(false);
    const dragStartPos = useRef({ x: 0, y: 0, panelX: 0, panelY: 0 });
    const resizeStartPos = useRef({ x: 0, y: 0, width: 0, height: 0 });
    const [zIndex, setZIndex] = useState(1000);

    // Increment global z-index counter to bring panel to front on click
    const bringToFront = useCallback(() => {
        setZIndex((DraggableModal as any).zCounter = ((DraggableModal as any).zCounter || 1000) + 1);
    }, []);

    useEffect(() => {
        if (open) {
            bringToFront();
            // Center panel on open
            const panelWidth = typeof width === 'number' ? width : 600;
            const x = Math.max(50, (window.innerWidth - panelWidth) / 2);
            const y = Math.max(50, window.innerHeight * 0.1);
            setPosition({ x, y });
            setSize({ width: panelWidth, height: 'auto' });
        }
    }, [open, width, bringToFront]);

    const handleDragStart = useCallback((e: React.MouseEvent) => {
        if ((e.target as HTMLElement).closest('button')) return;
        if (!position) return;
        e.preventDefault();
        setIsDragging(true);
        bringToFront();
        dragStartPos.current = { x: e.clientX, y: e.clientY, panelX: position.x, panelY: position.y };
    }, [position, bringToFront]);

    const handleResizeStart = useCallback((e: React.MouseEvent) => {
        if (!resizable) return;
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
    }, [bringToFront, resizable]);

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
                    width: Math.max(minWidth, resizeStartPos.current.width + deltaX),
                    height: Math.max(minHeight, resizeStartPos.current.height + deltaY)
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
    }, [isDragging, isResizing, minWidth, minHeight]);

    // Handle ESC key to close
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && open) {
                // Only close if we are the top-most modal
                // We assume zCounter holds the max zIndex
                const currentMaxZ = (DraggableModal as any).zCounter || 1000;
                if (zIndex >= currentMaxZ) {
                    onCancel?.(e as any);
                    e.stopPropagation(); // prevent closing multiple if they somehow share zIndex or event bubbles
                }
            }
        };

        if (open) {
            window.addEventListener('keydown', handleKeyDown);
        }
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [open, zIndex, onCancel]);

    const handleClose = useCallback((e: React.MouseEvent) => {
        onCancel?.(e as any);
    }, [onCancel]);

    const handleOk = useCallback((e: React.MouseEvent) => {
        onOk?.(e as any);
    }, [onOk]);

    if (!open) return null;

    // Determine footer content
    let footerContent: React.ReactNode = null;
    if (footer === undefined) {
        footerContent = (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <Button onClick={handleClose}>{cancelText}</Button>
                {onOk && <Button type="primary" onClick={handleOk}>{okText}</Button>}
            </div>
        );
    } else if (footer !== null) {
        footerContent = footer as React.ReactNode;
    }

    return (
        <div
            ref={panelRef}
            className={`floating-panel dark-theme-modal ${wrapClassName || ''}`}
            style={{
                position: 'fixed',
                left: position ? position.x : 0,
                top: position ? position.y : 0,
                visibility: position ? 'visible' : 'hidden', // Hide until positioned
                width: size.width,
                height: typeof size.height === 'number' ? size.height : undefined,
                zIndex,
                display: 'flex',
                flexDirection: 'column',
                backgroundColor: '#333',
                borderRadius: 8,
                boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
                border: '1px solid #444',
                overflow: 'hidden',
                maxHeight: '90vh'
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
                    borderBottom: '1px solid #444',
                    flexShrink: 0
                }}
            >
                <span style={{ color: '#fff', fontWeight: 500 }}>{title}</span>
                <Button
                    type="text"
                    size="small"
                    onClick={handleClose}
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
                    padding: restProps.styles?.body?.padding ?? 16,
                    backgroundColor: '#2d2d2d',
                    color: '#e8e8e8',
                    ...(restProps.styles?.body || {})
                }}
            >
                {children}
            </div>

            {/* Footer */}
            {footerContent && (
                <div
                    className="floating-panel-footer"
                    style={{
                        padding: '10px 16px',
                        backgroundColor: '#333',
                        borderTop: '1px solid #444',
                        flexShrink: 0
                    }}
                >
                    {footerContent}
                </div>
            )}

            {/* Resize Handle */}
            {resizable && (
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
                        borderBottomRightRadius: 8,
                        zIndex: 10
                    }}
                />
            )}
        </div>
    );
};
