import React, { useRef, useState, useCallback } from 'react';
import { Modal } from 'antd';
import type { ModalProps } from 'antd/es/modal';
import Draggable, { DraggableData, DraggableEvent } from 'react-draggable';

interface DraggableModalProps extends ModalProps {
    children: React.ReactNode;
    resizable?: boolean;
    minWidth?: number;
    minHeight?: number;
}

export const DraggableModal: React.FC<DraggableModalProps> = ({
    resizable = true,
    minWidth = 300,
    minHeight = 200,
    ...props
}) => {
    const [disabled, setDisabled] = useState(true);
    const [bounds, setBounds] = useState({ left: 0, top: 0, bottom: 0, right: 0 });
    const [size, setSize] = useState({ width: props.width || 600, height: 'auto' as number | 'auto' });
    const draggleRef = useRef<HTMLDivElement>(null);
    const resizeRef = useRef<{ startX: number; startY: number; startWidth: number; startHeight: number } | null>(null);

    const onStart = (_event: DraggableEvent, uiData: DraggableData) => {
        const { clientWidth, clientHeight } = window.document.documentElement;
        const targetRect = draggleRef.current?.getBoundingClientRect();
        if (!targetRect) {
            return;
        }
        setBounds({
            left: -targetRect.left + uiData.x,
            right: clientWidth - (targetRect.right - uiData.x),
            top: -targetRect.top + uiData.y,
            bottom: clientHeight - (targetRect.bottom - uiData.y),
        });
    };

    const handleResizeStart = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const rect = draggleRef.current?.getBoundingClientRect();
        if (!rect) return;

        resizeRef.current = {
            startX: e.clientX,
            startY: e.clientY,
            startWidth: rect.width,
            startHeight: rect.height
        };

        const handleMouseMove = (e: MouseEvent) => {
            if (!resizeRef.current) return;
            const deltaX = e.clientX - resizeRef.current.startX;
            const deltaY = e.clientY - resizeRef.current.startY;
            const newWidth = Math.max(minWidth, resizeRef.current.startWidth + deltaX);
            const newHeight = Math.max(minHeight, resizeRef.current.startHeight + deltaY);
            setSize({ width: newWidth, height: newHeight });
        };

        const handleMouseUp = () => {
            resizeRef.current = null;
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    }, [minWidth, minHeight]);

    return (
        <Modal
            {...props}
            width={size.width}
            mask={false}
            maskClosable={false}
            wrapClassName={`non-blocking-modal-wrap ${props.wrapClassName || ''}`}
            style={{ ...props.style, pointerEvents: 'auto' }}
            styles={{
                ...props.styles,
                wrapper: {
                    pointerEvents: 'none',
                    ...(props.styles?.wrapper || {})
                },
                body: {
                    height: typeof size.height === 'number' ? size.height - 55 : undefined,
                    overflow: 'auto',
                    ...(props.styles?.body || {})
                }
            }}
            modalRender={(modal) => (
                <Draggable
                    disabled={disabled}
                    bounds={bounds}
                    nodeRef={draggleRef}
                    onStart={(event, uiData) => onStart(event, uiData)}
                >
                    <div ref={draggleRef} style={{ pointerEvents: 'auto', position: 'relative' }}>
                        {modal}
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
                                    borderBottomRightRadius: 6,
                                    zIndex: 10
                                }}
                            />
                        )}
                    </div>
                </Draggable>
            )}
            title={
                <div
                    style={{
                        width: '100%',
                        cursor: 'move',
                        padding: '10px 24px',
                        margin: '-20px -24px',
                        borderTopLeftRadius: '8px',
                        borderTopRightRadius: '8px',
                    }}
                    onMouseOver={() => {
                        if (disabled) {
                            setDisabled(false);
                        }
                    }}
                    onMouseOut={() => {
                        setDisabled(true);
                    }}
                    onFocus={() => { }}
                    onBlur={() => { }}
                >
                    {props.title}
                </div>
            }
        >
            {props.children}
        </Modal>
    );
};
