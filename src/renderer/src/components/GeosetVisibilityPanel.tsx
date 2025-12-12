import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Checkbox } from 'antd';
import { EyeOutlined, EyeInvisibleOutlined, CloseOutlined, MinusOutlined } from '@ant-design/icons';
import { useModelStore } from '../store/modelStore';

interface GeosetVisibilityPanelProps {
    visible: boolean;
    onClose: () => void;
}

export const GeosetVisibilityPanel: React.FC<GeosetVisibilityPanelProps> = ({ visible, onClose }) => {
    const {
        modelData,
        hiddenGeosetIds,
        forceShowAllGeosets,
        hoveredGeosetId,
        toggleGeosetVisibility,
        setForceShowAllGeosets,
        setHoveredGeosetId
    } = useModelStore();

    const [position, setPosition] = useState({ x: 20, y: 80 });
    const [size, setSize] = useState({ width: 200, height: 300 });
    const [isDragging, setIsDragging] = useState(false);
    const [isResizing, setIsResizing] = useState<'right' | 'bottom' | 'corner' | null>(null);
    const [isMinimized, setIsMinimized] = useState(false);
    const dragStart = useRef({ x: 0, y: 0, posX: 0, posY: 0, width: 0, height: 0 });
    const panelRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);

    const geosets = modelData?.Geosets || [];

    // Calculate grid columns based on panel width (each item ~50px)
    const gridColumns = Math.max(1, Math.floor((size.width - 16) / 50));

    // Handle dragging
    const handleMouseDown = (e: React.MouseEvent) => {
        if ((e.target as HTMLElement).closest('.panel-control-btn')) return;
        if ((e.target as HTMLElement).closest('.resize-handle')) return;
        setIsDragging(true);
        dragStart.current = {
            x: e.clientX,
            y: e.clientY,
            posX: position.x,
            posY: position.y,
            width: size.width,
            height: size.height
        };
    };

    // Handle resize start
    const handleResizeStart = useCallback((e: React.MouseEvent, direction: 'right' | 'bottom' | 'corner') => {
        e.stopPropagation();
        setIsResizing(direction);
        dragStart.current = {
            x: e.clientX,
            y: e.clientY,
            posX: position.x,
            posY: position.y,
            width: size.width,
            height: size.height
        };
    }, [position, size]);

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (isDragging) {
                const deltaX = e.clientX - dragStart.current.x;
                const deltaY = e.clientY - dragStart.current.y;
                setPosition({
                    x: dragStart.current.posX - deltaX,  // Subtract for right-anchored
                    y: dragStart.current.posY + deltaY
                });
            }
            if (isResizing) {
                const deltaX = e.clientX - dragStart.current.x;
                const deltaY = e.clientY - dragStart.current.y;

                if (isResizing === 'right' || isResizing === 'corner') {
                    // For right-anchored panel, moving right means decreasing width
                    const newWidth = Math.max(120, dragStart.current.width - deltaX);
                    setSize(prev => ({ ...prev, width: newWidth }));
                }
                if (isResizing === 'bottom' || isResizing === 'corner') {
                    const newHeight = Math.max(100, dragStart.current.height + deltaY);
                    setSize(prev => ({ ...prev, height: newHeight }));
                }
            }
        };

        const handleMouseUp = () => {
            setIsDragging(false);
            setIsResizing(null);
        };

        if (isDragging || isResizing) {
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
        }

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging, isResizing]);

    if (!visible) return null;

    const isGeosetChecked = (id: number) => {
        return !hiddenGeosetIds.includes(id);
    };

    return (
        <div
            ref={panelRef}
            style={{
                position: 'fixed',
                right: position.x,
                top: position.y,
                width: isMinimized ? 120 : size.width,
                height: isMinimized ? 'auto' : size.height,
                backgroundColor: 'rgba(30, 30, 30, 0.95)',
                border: '1px solid rgba(80, 80, 80, 0.6)',
                borderRadius: 4,
                boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                zIndex: 1000,
                userSelect: 'none',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden'
            }}
        >
            {/* Title Bar */}
            <div
                onMouseDown={handleMouseDown}
                style={{
                    backgroundColor: 'rgba(40, 40, 40, 0.95)',
                    padding: '5px 8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: isDragging ? 'grabbing' : 'grab',
                    borderBottom: '1px solid rgba(60, 60, 60, 0.8)',
                    flexShrink: 0
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Checkbox
                        checked={forceShowAllGeosets}
                        onChange={(e) => setForceShowAllGeosets(e.target.checked)}
                    />
                    <span style={{ color: '#ddd', fontSize: 11, fontWeight: 500 }}>
                        {forceShowAllGeosets ? <EyeOutlined /> : <EyeInvisibleOutlined />} 全部
                    </span>
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                    <button
                        className="panel-control-btn"
                        onClick={() => setIsMinimized(!isMinimized)}
                        style={{
                            background: 'none',
                            border: 'none',
                            color: '#aaa',
                            cursor: 'pointer',
                            padding: 2
                        }}
                    >
                        <MinusOutlined style={{ fontSize: 11 }} />
                    </button>
                    <button
                        className="panel-control-btn"
                        onClick={onClose}
                        style={{
                            background: 'none',
                            border: 'none',
                            color: '#aaa',
                            cursor: 'pointer',
                            padding: 2
                        }}
                    >
                        <CloseOutlined style={{ fontSize: 11 }} />
                    </button>
                </div>
            </div>

            {/* Content - Adaptive grid */}
            {!isMinimized && (
                <div
                    ref={contentRef}
                    style={{
                        flex: 1,
                        overflowY: 'auto',
                        padding: '6px 8px',
                        display: 'grid',
                        gridTemplateColumns: `repeat(${gridColumns}, 1fr)`,
                        gap: '2px 4px',
                        alignContent: 'start'
                    }}
                >
                    {geosets.length === 0 ? (
                        <div style={{ gridColumn: `span ${gridColumns}`, padding: 8, color: '#888', fontSize: 11, textAlign: 'center' }}>
                            无多边形
                        </div>
                    ) : (
                        geosets.map((_geoset: any, index: number) => (
                            <div
                                key={index}
                                onMouseEnter={() => setHoveredGeosetId(index)}
                                onMouseLeave={() => setHoveredGeosetId(null)}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    padding: '2px 4px',
                                    cursor: 'pointer',
                                    backgroundColor: hoveredGeosetId === index ? 'rgba(70, 130, 220, 0.4)' : 'transparent',
                                    borderRadius: 2,
                                    transition: 'background-color 0.1s'
                                }}
                                onClick={() => toggleGeosetVisibility(index)}
                            >
                                <Checkbox
                                    checked={isGeosetChecked(index)}
                                    onChange={() => toggleGeosetVisibility(index)}
                                    style={{ marginRight: 4 }}
                                />
                                <span style={{
                                    color: isGeosetChecked(index) ? '#ddd' : '#666',
                                    fontSize: 11
                                }}>
                                    {index}
                                </span>
                            </div>
                        ))
                    )}
                </div>
            )}

            {/* Footer with count */}
            {!isMinimized && geosets.length > 0 && (
                <div style={{
                    padding: '3px 8px',
                    borderTop: '1px solid rgba(60, 60, 60, 0.8)',
                    fontSize: 10,
                    color: '#888',
                    textAlign: 'right',
                    flexShrink: 0
                }}>
                    共 {geosets.length} 个 | {gridColumns} 列
                </div>
            )}

            {/* Resize Handles */}
            {!isMinimized && (
                <>
                    {/* Left edge resize (since panel is right-anchored) */}
                    <div
                        className="resize-handle"
                        onMouseDown={(e) => handleResizeStart(e, 'right')}
                        style={{
                            position: 'absolute',
                            left: 0,
                            top: 0,
                            width: 6,
                            height: '100%',
                            cursor: 'ew-resize'
                        }}
                    />
                    {/* Bottom edge resize */}
                    <div
                        className="resize-handle"
                        onMouseDown={(e) => handleResizeStart(e, 'bottom')}
                        style={{
                            position: 'absolute',
                            bottom: 0,
                            left: 0,
                            width: '100%',
                            height: 6,
                            cursor: 'ns-resize'
                        }}
                    />
                    {/* Bottom-left corner resize */}
                    <div
                        className="resize-handle"
                        onMouseDown={(e) => handleResizeStart(e, 'corner')}
                        style={{
                            position: 'absolute',
                            bottom: 0,
                            left: 0,
                            width: 12,
                            height: 12,
                            cursor: 'nesw-resize'
                        }}
                    />
                </>
            )}
        </div>
    );
};

export default GeosetVisibilityPanel;

