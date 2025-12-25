import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Checkbox, message } from 'antd';
import { EyeOutlined, EyeInvisibleOutlined, CloseOutlined, MinusOutlined, DeleteOutlined, MergeCellsOutlined } from '@ant-design/icons';
import { useModelStore } from '../store/modelStore';
import { commandManager } from '../utils/CommandManager';
import { SetGeosetVisibilityCommand } from '../commands/SetGeosetVisibilityCommand';
import { GeosetMergeDialog } from './modals/GeosetMergeDialog';

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
        setForceShowAllGeosets,
        setHoveredGeosetId,
        setGeosets,
        setMaterials,
        selectedGeosetIndex,
        setSelectedGeosetIndex
    } = useModelStore();

    // Imports for command manager (ensure these are imported at top of file)
    // We'll trust the import block to be handled by the user or auto-added if I can't reach top.
    // Wait, I should add imports at the top. But let's check if I can reach line 1.
    // I'll do a separate chunk for imports.

    const [position, setPosition] = useState({ x: 20, y: 80 });
    const [size, setSize] = useState({ width: 220, height: 350 });
    const [isDragging, setIsDragging] = useState(false);
    const [isResizing, setIsResizing] = useState<'right' | 'bottom' | 'corner' | null>(null);
    const [isMinimized, setIsMinimized] = useState(false);
    const dragStart = useRef({ x: 0, y: 0, posX: 0, posY: 0, width: 0, height: 0 });
    const panelRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);

    // Selection state
    const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
    const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null);

    // Sync from global store to local state
    useEffect(() => {
        if (selectedGeosetIndex !== null) {
            // Only update if not already matching single selection to avoid thrashing
            if (selectedIndices.length !== 1 || selectedIndices[0] !== selectedGeosetIndex) {
                setSelectedIndices([selectedGeosetIndex]);
            }
        }
    }, [selectedGeosetIndex]);

    // Context menu state
    const [contextMenuVisible, setContextMenuVisible] = useState(false);
    const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });

    // Merge dialog state
    const [mergeDialogVisible, setMergeDialogVisible] = useState(false);

    const geosets = modelData?.Geosets || [];

    // Handle item click for selection
    const handleItemClick = (index: number, e: React.MouseEvent) => {
        e.stopPropagation();

        if (e.ctrlKey || e.metaKey) {
            // Ctrl+Click: Toggle selection
            setSelectedIndices(prev =>
                prev.includes(index)
                    ? prev.filter(i => i !== index)
                    : [...prev, index]
            );
        } else if (e.shiftKey && lastClickedIndex !== null) {
            // Shift+Click: Range selection (subtract mode per user request)
            const start = Math.min(lastClickedIndex, index);
            const end = Math.max(lastClickedIndex, index);
            const rangeIndices = Array.from({ length: end - start + 1 }, (_, i) => start + i);
            // Remove range from selection
            setSelectedIndices(prev => prev.filter(i => !rangeIndices.includes(i)));
        } else {
            // Regular click: Clear and select one
            setSelectedIndices([index]);
            setSelectedGeosetIndex(index);
        }
        setLastClickedIndex(index);
    };

    // Handle right-click context menu
    const handleContextMenu = (e: React.MouseEvent, index: number) => {
        e.preventDefault();
        e.stopPropagation();

        // If right-clicking on unselected item, select it
        if (!selectedIndices.includes(index)) {
            setSelectedIndices([index]);
        }

        setContextMenuPosition({ x: e.clientX, y: e.clientY });
        setContextMenuVisible(true);
    };

    // Close context menu when clicking elsewhere
    useEffect(() => {
        if (contextMenuVisible) {
            const handleClick = () => setContextMenuVisible(false);
            document.addEventListener('click', handleClick);
            return () => document.removeEventListener('click', handleClick);
        }
        return undefined;
    }, [contextMenuVisible]);

    // Delete selected geosets
    const handleDeleteGeosets = () => {
        if (selectedIndices.length === 0) return;

        const sortedIndices = [...selectedIndices].sort((a, b) => b - a);
        const newGeosets = [...geosets];

        sortedIndices.forEach(idx => {
            newGeosets.splice(idx, 1);
        });

        setGeosets(newGeosets);
        setSelectedIndices([]);
        setContextMenuVisible(false);
        message.success(`已删除 ${sortedIndices.length} 个多边形`);
    };

    // Handle merge confirmation
    const handleMergeConfirm = (materialIndex: number) => {
        console.log('[Merge] Starting merge with selectedIndices:', selectedIndices);
        console.log('[Merge] Total geosets count:', geosets.length);

        if (selectedIndices.length < 2) {
            message.error('请选择至少2个多边形');
            return;
        }

        // Sort indices - smallest first (will be target)
        const sortedIndices = [...selectedIndices].sort((a, b) => a - b);
        const targetIndex = sortedIndices[0];

        console.log('[Merge] Sorted indices:', sortedIndices);
        console.log('[Merge] Target index:', targetIndex);

        // Deep copy the target geoset
        const targetGeoset: any = { ...geosets[targetIndex] };

        // Merge all other geosets into target
        for (let i = 1; i < sortedIndices.length; i++) {
            const srcIndex = sortedIndices[i];
            console.log('[Merge] Merging source geoset at index:', srcIndex);
            const srcGeoset: any = geosets[srcIndex];

            // Calculate offset for face indices (number of vertices, not floats)
            const targetVertexCount = (targetGeoset.Vertices?.length || 0) / 3;
            const srcVertexFloats = srcGeoset.Vertices?.length || 0;

            // Merge Vertices (Float32Array)
            if (srcGeoset.Vertices && srcGeoset.Vertices.length > 0) {
                const targetLen = targetGeoset.Vertices?.length || 0;
                const newVertices = new Float32Array(targetLen + srcVertexFloats);
                if (targetGeoset.Vertices) {
                    newVertices.set(new Float32Array(targetGeoset.Vertices), 0);
                }
                newVertices.set(new Float32Array(srcGeoset.Vertices), targetLen);
                targetGeoset.Vertices = newVertices;
            }

            // Merge Normals (Float32Array)
            if (srcGeoset.Normals && srcGeoset.Normals.length > 0) {
                const targetLen = targetGeoset.Normals?.length || 0;
                const srcLen = srcGeoset.Normals.length;
                const newNormals = new Float32Array(targetLen + srcLen);
                if (targetGeoset.Normals) {
                    newNormals.set(new Float32Array(targetGeoset.Normals), 0);
                }
                newNormals.set(new Float32Array(srcGeoset.Normals), targetLen);
                targetGeoset.Normals = newNormals;
            }

            // Merge UVs (TVertices - Array of Float32Array)
            // Ensure UVs align with vertices (2 UV floats per vertex)
            // Note: Vertices have ALREADY been merged above, so targetGeoset.Vertices includes srcGeoset vertices!
            const totalVCount = (targetGeoset.Vertices?.length || 0) / 3;
            const srcVCount = (srcGeoset.Vertices?.length || 0) / 3;
            const originalTargetVCount = totalVCount - srcVCount;

            const totalUVLen = totalVCount * 2;
            const srcOffset = originalTargetVCount * 2;

            if (totalUVLen > 0) {
                const newUVs = new Float32Array(totalUVLen);

                // Inspect structure - fetch channel 0
                const targetCh0 = (targetGeoset.TVertices && targetGeoset.TVertices.length > 0 && targetGeoset.TVertices[0])
                    ? targetGeoset.TVertices[0]
                    : null;
                const srcCh0 = (srcGeoset.TVertices && srcGeoset.TVertices.length > 0 && srcGeoset.TVertices[0])
                    ? srcGeoset.TVertices[0]
                    : null;

                // Copy target UVs or pad with zeros
                if (targetCh0) {
                    newUVs.set(new Float32Array(targetCh0), 0);
                } else {
                    // No UVs on target, but likely need zeros for the target part
                    console.log('[Merge] Warning: Target geoset missing UVs (ch0), padding with zeros');
                }

                // Copy source UVs or pad with zeros at correct offset
                if (srcCh0) {
                    newUVs.set(new Float32Array(srcCh0), srcOffset);
                } else {
                    console.log('[Merge] Warning: Source geoset missing UVs (ch0), padding with zeros');
                }

                // Important: Wrap in array as TVertices expects array of channels
                targetGeoset.TVertices = [newUVs];
            }

            // Merge Faces with offset (Uint16Array)
            if (srcGeoset.Faces && srcGeoset.Faces.length > 0) {
                const targetLen = targetGeoset.Faces?.length || 0;
                const srcLen = srcGeoset.Faces.length;
                const newFaces = new Uint16Array(targetLen + srcLen);
                if (targetGeoset.Faces) {
                    newFaces.set(new Uint16Array(targetGeoset.Faces), 0);
                }
                // Add offset to source face indices
                for (let j = 0; j < srcLen; j++) {
                    newFaces[targetLen + j] = srcGeoset.Faces[j] + targetVertexCount;
                }
                targetGeoset.Faces = newFaces;
            }

            // Merge VertexGroup (bone group indices for each vertex)
            if (srcGeoset.VertexGroup && srcGeoset.VertexGroup.length > 0) {
                const targetLen = targetGeoset.VertexGroup?.length || 0;
                const srcLen = srcGeoset.VertexGroup.length;
                // Offset for Groups array
                const groupOffset = targetGeoset.Groups?.length || 0;
                const newGroups = new Uint8Array(targetLen + srcLen);
                if (targetGeoset.VertexGroup) {
                    newGroups.set(new Uint8Array(targetGeoset.VertexGroup), 0);
                }
                // Add group offset to source VertexGroup indices
                for (let j = 0; j < srcLen; j++) {
                    newGroups[targetLen + j] = srcGeoset.VertexGroup[j] + groupOffset;
                }
                targetGeoset.VertexGroup = newGroups;
            }

            // Merge Groups (bone assignments array)
            if (srcGeoset.Groups && srcGeoset.Groups.length > 0) {
                targetGeoset.Groups = [...(targetGeoset.Groups || []), ...srcGeoset.Groups];
            }
        }

        // Set material
        console.log('[Merge] Setting material. Selected Index:', materialIndex);
        if (materialIndex === -1) {
            // Create new white material
            const materials: any[] = [...(modelData?.Materials || [])];
            const textures: any[] = [...(modelData?.Textures || [])];

            // Add white texture
            const newTextureIndex = textures.length;
            textures.push({
                Path: 'Textures\\white.blp',
                ReplaceableId: 0,
                Flags: 0
            });

            // Add new material referencing white texture
            const newMaterialIndex = materials.length;
            materials.push({
                Layers: [{
                    FilterMode: 0,
                    TextureID: newTextureIndex,
                    Alpha: 1,
                    Shading: 0,
                    CoordId: 0
                }],
                PriorityPlane: 0,
                RenderMode: 0
            });

            targetGeoset.MaterialID = newMaterialIndex;
            useModelStore.getState().setTextures(textures);
            setMaterials(materials);
        } else {
            console.log('[Merge] Assigning existing material ID:', materialIndex);
            targetGeoset.MaterialID = materialIndex;
        }

        // Build new geosets array:
        // - Keep geosets that are NOT in the merge selection
        // - Replace the first selected geoset with the merged result
        const indicesToRemove = new Set(sortedIndices.slice(1)); // Remove all except first
        const newGeosets: any[] = [];

        for (let i = 0; i < geosets.length; i++) {
            if (indicesToRemove.has(i)) {
                continue; // Skip geosets being merged (except target)
            }
            if (i === targetIndex) {
                newGeosets.push(targetGeoset); // Use merged geoset
            } else {
                newGeosets.push(geosets[i]);
            }
        }

        console.log('[Merge] Indices to remove (except target):', Array.from(indicesToRemove));
        console.log('[Merge] Old geosets count:', geosets.length);
        console.log('[Merge] New geosets count:', newGeosets.length);

        // Update state and modelStore (lightweight update)
        setGeosets(newGeosets);
        useModelStore.getState().setGeosets(newGeosets);
        setSelectedIndices([]);
        setMergeDialogVisible(false);
        message.success(`已合并 ${sortedIndices.length} 个多边形`);
    };

    // Handle dragging
    const handleMouseDown = (e: React.MouseEvent) => {
        if ((e.target as HTMLElement).closest('.panel-control-btn')) return;
        if ((e.target as HTMLElement).closest('.resize-handle')) return;
        if ((e.target as HTMLElement).closest('.geoset-item')) return;
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
                    x: dragStart.current.posX - deltaX,
                    y: dragStart.current.posY + deltaY
                });
            }
            if (isResizing) {
                const deltaX = e.clientX - dragStart.current.x;
                const deltaY = e.clientY - dragStart.current.y;

                if (isResizing === 'right' || isResizing === 'corner') {
                    const newWidth = Math.max(150, dragStart.current.width - deltaX);
                    setSize(prev => ({ ...prev, width: newWidth }));
                }
                if (isResizing === 'bottom' || isResizing === 'corner') {
                    const newHeight = Math.max(120, dragStart.current.height + deltaY);
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

    const isGeosetVisible = (id: number) => !hiddenGeosetIds.includes(id);

    return (
        <>
            <div
                ref={panelRef}
                style={{
                    position: 'fixed',
                    right: position.x,
                    top: position.y,
                    width: isMinimized ? 140 : size.width,
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
                        <div style={{ display: 'flex', gap: 4, marginLeft: 4 }}>
                            <button
                                className="panel-control-btn"
                                onClick={() => {
                                    const cmd = new SetGeosetVisibilityCommand([]);
                                    commandManager.execute(cmd);
                                }}
                                style={{
                                    background: 'rgba(60, 130, 200, 0.3)',
                                    border: '1px solid #4a9eff',
                                    borderRadius: 3,
                                    color: '#8bc4ff',
                                    cursor: 'pointer',
                                    padding: '2px 6px',
                                    fontSize: 10
                                }}
                                title="全选"
                            >
                                ✓全选
                            </button>
                            <button
                                className="panel-control-btn"
                                onClick={() => {
                                    const cmd = new SetGeosetVisibilityCommand(geosets.map((_, i) => i));
                                    commandManager.execute(cmd);
                                }}
                                style={{
                                    background: 'rgba(100, 100, 100, 0.3)',
                                    border: '1px solid #666',
                                    borderRadius: 3,
                                    color: '#aaa',
                                    cursor: 'pointer',
                                    padding: '2px 6px',
                                    fontSize: 10
                                }}
                                title="取消全选"
                            >
                                取消
                            </button>
                        </div>
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

                {/* Content - Adaptive Grid View */}
                {!isMinimized && (
                    <div
                        ref={contentRef}
                        style={{
                            flex: 1,
                            overflowY: 'auto',
                            padding: '6px 8px',
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: '4px',
                            alignContent: 'flex-start'
                        }}
                    >
                        {geosets.length === 0 ? (
                            <div style={{ width: '100%', padding: 12, color: '#888', fontSize: 11, textAlign: 'center' }}>
                                无多边形
                            </div>
                        ) : (
                            geosets.map((_geoset: any, index: number) => {
                                const isSelected = selectedIndices.includes(index);
                                const isHovered = hoveredGeosetId === index;

                                return (
                                    <div
                                        key={index}
                                        className="geoset-item"
                                        onMouseEnter={() => setHoveredGeosetId(index)}
                                        onMouseLeave={() => setHoveredGeosetId(null)}
                                        onClick={(e) => handleItemClick(index, e)}
                                        onContextMenu={(e) => handleContextMenu(e, index)}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '2px',
                                            padding: '3px 6px',
                                            cursor: 'pointer',
                                            backgroundColor: isSelected
                                                ? 'rgba(50, 120, 220, 0.6)'
                                                : isHovered
                                                    ? 'rgba(70, 130, 220, 0.3)'
                                                    : 'rgba(50, 50, 50, 0.5)',
                                            borderRadius: 3,
                                            border: isSelected ? '1px solid #4a9eff' : '1px solid transparent',
                                            transition: 'background-color 0.1s'
                                        }}
                                    >
                                        {/* Visibility Checkbox - Next to text */}
                                        <Checkbox
                                            checked={isGeosetVisible(index)}
                                            onChange={(e) => {
                                                e.stopPropagation();
                                                const nativeEvent = e.nativeEvent as MouseEvent;
                                                const isAlt = nativeEvent.altKey;

                                                if (isAlt) {
                                                    // Exclusive Visibility Mode
                                                    console.log('[GeosetVisibilityPanel] Exclusive Visibility for Geoset', index);

                                                    // Hide ALL except current index
                                                    const allOtherIndices = geosets.map((_, i) => i).filter(i => i !== index);
                                                    // Pass 'false' for forceShowAllGeosets (disable "Show All")
                                                    commandManager.execute(new SetGeosetVisibilityCommand(allOtherIndices, false));
                                                } else {
                                                    // Standard Toggle Mode
                                                    // Calculate new hidden IDs for undo support
                                                    const newHiddenIds = hiddenGeosetIds.includes(index)
                                                        ? hiddenGeosetIds.filter(id => id !== index)
                                                        : [...hiddenGeosetIds, index];
                                                    commandManager.execute(new SetGeosetVisibilityCommand(newHiddenIds));
                                                }
                                            }}
                                            onClick={(e) => e.stopPropagation()}
                                            style={{ marginRight: 0 }}
                                        />
                                        {/* Name/ID */}
                                        <span style={{
                                            color: isSelected ? '#fff' : '#ccc',
                                            fontSize: 11,
                                            fontWeight: isSelected ? 500 : 400,
                                            whiteSpace: 'nowrap'
                                        }}>
                                            Geoset {index}
                                        </span>
                                    </div>
                                );
                            })
                        )}
                    </div>
                )}

                {/* Footer */}
                {!isMinimized && geosets.length > 0 && (
                    <div style={{
                        padding: '4px 8px',
                        borderTop: '1px solid rgba(60, 60, 60, 0.8)',
                        fontSize: 10,
                        color: '#888',
                        display: 'flex',
                        justifyContent: 'space-between',
                        flexShrink: 0
                    }}>
                        <span>共 {geosets.length} 个</span>
                        <span>{selectedIndices.length > 0 ? `已选 ${selectedIndices.length}` : ''}</span>
                    </div>
                )}

                {/* Resize Handles */}
                {!isMinimized && (
                    <>
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

            {/* Context Menu */}
            {contextMenuVisible && (
                <div
                    style={{
                        position: 'fixed',
                        left: contextMenuPosition.x,
                        top: contextMenuPosition.y,
                        backgroundColor: 'rgba(40, 40, 40, 0.98)',
                        border: '1px solid rgba(80, 80, 80, 0.6)',
                        borderRadius: 4,
                        boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                        zIndex: 1100,
                        padding: '4px 0',
                        minWidth: 120
                    }}
                >
                    {/* Merge - First */}
                    <div
                        onClick={() => {
                            if (selectedIndices.length >= 2) {
                                setMergeDialogVisible(true);
                                setContextMenuVisible(false);
                            }
                        }}
                        style={{
                            padding: '6px 12px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            cursor: selectedIndices.length >= 2 ? 'pointer' : 'not-allowed',
                            color: selectedIndices.length >= 2 ? '#69b1ff' : '#555',
                            fontSize: 12
                        }}
                        onMouseEnter={(e) => {
                            if (selectedIndices.length >= 2) {
                                e.currentTarget.style.backgroundColor = 'rgba(100,150,255,0.2)';
                            }
                        }}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                    >
                        <MergeCellsOutlined /> 合并 {selectedIndices.length < 2 && '(需选≥2)'}
                    </div>
                    {/* Delete - Second */}
                    <div
                        onClick={handleDeleteGeosets}
                        style={{
                            padding: '6px 12px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            cursor: 'pointer',
                            color: '#ff6b6b',
                            fontSize: 12
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,100,100,0.2)'}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                    >
                        <DeleteOutlined /> 删除
                    </div>
                </div>
            )}

            {/* Merge Dialog */}
            <GeosetMergeDialog
                visible={mergeDialogVisible}
                selectedGeosetIndices={selectedIndices}
                onCancel={() => setMergeDialogVisible(false)}
                onConfirm={handleMergeConfirm}
            />
        </>
    );
};

export default GeosetVisibilityPanel;
