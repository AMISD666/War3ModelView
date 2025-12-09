import React, { useRef, useState } from 'react';
import { Modal } from 'antd';
import type { ModalProps } from 'antd/es/modal';
import Draggable, { DraggableData, DraggableEvent } from 'react-draggable';

interface DraggableModalProps extends ModalProps {
    children: React.ReactNode;
}

export const DraggableModal: React.FC<DraggableModalProps> = (props) => {
    const [disabled, setDisabled] = useState(true); // Disable dragging by default (enable on hover title)
    const [bounds, setBounds] = useState({ left: 0, top: 0, bottom: 0, right: 0 });
    const draggleRef = useRef<HTMLDivElement>(null);

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

    return (
        <Modal
            {...props}
            modalRender={(modal) => (
                <Draggable
                    disabled={disabled}
                    bounds={bounds}
                    nodeRef={draggleRef}
                    onStart={(event, uiData) => onStart(event, uiData)}
                >
                    <div ref={draggleRef}>{modal}</div>
                </Draggable>
            )}
            title={
                <div
                    style={{
                        width: '100%',
                        cursor: 'move',
                        padding: '10px 24px', // Add some padding to look like a proper header
                        margin: '-20px -24px', // Counteract default Antd modal title margin/padding
                        borderTopLeftRadius: '8px', // Match default modal radius
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
                    // Focus fix for input elements inside modal not being selectable if dragging is always on
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
