import React from 'react';
import { Tooltip } from 'antd';
import { EyeInvisibleOutlined, EyeOutlined } from '@ant-design/icons';
import type { TreeNode } from '../../../types/node';
import {
    getNodeRowStyle,
    nodeObjectIdStyle,
    nodeTitleTextStyle
} from './styles';

interface NodeTreeTitleProps {
    nodeData: TreeNode;
    draggedNodeId: number | null;
    dropTargetNodeId: number | null;
    cutNodeId: number | null;
    hiddenNodeIdSet: Set<number>;
    isDragging: boolean;
    draggedNodeIdRef: React.MutableRefObject<number | null>;
    dropTargetNodeIdRef: React.MutableRefObject<number | null>;
    isDraggingRef: React.MutableRefObject<boolean>;
    setDraggedNodeId: (nodeId: number | null) => void;
    setDropTargetNodeId: (nodeId: number | null) => void;
    setIsDragging: (isDragging: boolean) => void;
    setDragPosition: (position: { x: number; y: number }) => void;
    onMoveNodes: (nodeId: number, targetId: number) => void;
    toggleNodeVisibility: (nodeId: number) => void;
    focusTreeSurface: () => void;
}

export const NodeTreeTitle: React.FC<NodeTreeTitleProps> = ({
    nodeData,
    draggedNodeId,
    dropTargetNodeId,
    cutNodeId,
    hiddenNodeIdSet,
    isDragging,
    draggedNodeIdRef,
    dropTargetNodeIdRef,
    isDraggingRef,
    setDraggedNodeId,
    setDropTargetNodeId,
    setIsDragging,
    setDragPosition,
    onMoveNodes,
    toggleNodeVisibility,
    focusTreeSurface
}) => {
    const nodeId = nodeData.data?.ObjectId ?? parseInt(nodeData.key);
    const isVirtualRoot = nodeData.isVirtualRoot === true || nodeId === -1;
    const isDropTarget = dropTargetNodeId === nodeId;
    const isDraggingThis = isDragging && draggedNodeId === nodeId;
    const isCut = cutNodeId === nodeId;
    const isNodeVisible = isVirtualRoot || !hiddenNodeIdSet.has(nodeId);

    const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
        if (e.button !== 0 || isVirtualRoot) return;

        e.preventDefault();

        const startX = e.clientX;
        const startY = e.clientY;
        let dragStarted = false;

        const handleMouseMove = (moveEvent: MouseEvent) => {
            const deltaX = Math.abs(moveEvent.clientX - startX);
            const deltaY = Math.abs(moveEvent.clientY - startY);

            if (!dragStarted && (deltaX > 5 || deltaY > 5)) {
                dragStarted = true;
                draggedNodeIdRef.current = nodeId;
                isDraggingRef.current = true;
                setDraggedNodeId(nodeId);
                setIsDragging(true);
            }

            if (!dragStarted) return;

            setDragPosition({ x: moveEvent.clientX, y: moveEvent.clientY });

            const elementUnderMouse = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
            if (!elementUnderMouse) return;

            const nodeItem = elementUnderMouse.closest('[data-node-id]') as HTMLElement | null;
            if (!nodeItem) {
                dropTargetNodeIdRef.current = null;
                setDropTargetNodeId(null);
                return;
            }

            const targetId = parseInt(nodeItem.dataset.nodeId || '');
            if (!Number.isNaN(targetId) && targetId !== nodeId) {
                dropTargetNodeIdRef.current = targetId;
                setDropTargetNodeId(targetId);
            }
        };

        const handleMouseUp = () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);

            if (dragStarted) {
                const targetId = dropTargetNodeIdRef.current;
                if (targetId !== null && targetId !== nodeId) {
                    onMoveNodes(nodeId, targetId);
                }

                isDraggingRef.current = false;
                draggedNodeIdRef.current = null;
                dropTargetNodeIdRef.current = null;
                setIsDragging(false);
                setDraggedNodeId(null);
                setDropTargetNodeId(null);
            }
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    };

    return (
        <div
            data-node-id={nodeId}
            className={`node-manager-row${isNodeVisible ? '' : ' node-manager-row-hidden'}`}
            onMouseDown={handleMouseDown}
            style={getNodeRowStyle({ isVirtualRoot, isDraggingThis, isDropTarget, isCut })}
        >
            {isVirtualRoot ? (
                <span className="node-manager-visibility-cell" aria-hidden="true" />
            ) : (
                <Tooltip title={isNodeVisible ? '闅愯棌鑺傜偣' : '鏄剧ず鑺傜偣'} mouseEnterDelay={0.3}>
                    <button
                        type="button"
                        className={`node-manager-visibility-button${isNodeVisible ? '' : ' is-hidden'}`}
                        aria-label={isNodeVisible ? '闅愯棌鑺傜偣' : '鏄剧ず鑺傜偣'}
                        aria-pressed={!isNodeVisible}
                        onMouseDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                        }}
                        onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            toggleNodeVisibility(nodeId);
                            focusTreeSurface();
                        }}
                    >
                        {isNodeVisible ? <EyeOutlined /> : <EyeInvisibleOutlined />}
                    </button>
                </Tooltip>
            )}
            <span style={nodeTitleTextStyle(isVirtualRoot, isNodeVisible)}>
                {nodeData.title}
            </span>
            {!isVirtualRoot && (
                <span style={nodeObjectIdStyle}>
                    {nodeData.data.ObjectId ?? ''}
                </span>
            )}
        </div>
    );
};
