import React, { useState, useEffect, useRef } from 'react';
import { Button, Typography, Tooltip, Select } from 'antd';
import { DeleteOutlined, FileImageOutlined, CopyOutlined, WarningOutlined } from '@ant-design/icons';
import { AnimatedPreview } from './AnimatedPreview';
import { thumbnailEventBus } from './ThumbnailEventBus';

const { Text } = Typography;

interface ModelFile {
    name: string;
    path: string;
    fullPath: string;
}

interface ModelCardProps {
    file: ModelFile;
    initialAnimations?: string[];
    initialSelectedAnimation?: string;
    fixedSize?: number;
    isSelected?: boolean;
    showAnimationSelect?: boolean;
    onDelete: (file: ModelFile) => void;
    onEditTexture: (file: ModelFile) => void;
    onCopy?: (file: ModelFile) => void;
    onAnimationChange?: (file: ModelFile, animation: string) => void;
    onSelect?: (file: ModelFile) => void;
    onDoubleClick?: (file: ModelFile) => void;
    onVisibilityChange?: (fullPath: string, isVisible: boolean) => void;
}

function pickPreferredAnimation(animations: string[]): string | undefined {
    if (animations.length === 0) return undefined;

    const exactStand = animations.find((name) => name.trim().toLowerCase() === 'stand');
    if (exactStand) return exactStand;

    const standPrefix = animations.find((name) => /^stand(\b|[^a-z0-9_])/i.test(name.trim()));
    if (standPrefix) return standPrefix;

    const standContains = animations.find((name) => name.trim().toLowerCase().includes('stand'));
    return standContains ?? animations[0];
}

export const ModelCard: React.FC<ModelCardProps> = React.memo(({
    file,
    initialAnimations = [],
    initialSelectedAnimation,
    fixedSize = 160,
    isSelected = false,
    showAnimationSelect = true,
    onDelete,
    onEditTexture,
    onCopy,
    onAnimationChange,
    onSelect,
    onDoubleClick,
    onVisibilityChange
}) => {
    const [animations, setAnimations] = useState<string[]>(initialAnimations);
    const [selectedAnimation, setSelectedAnimation] = useState<string | undefined>(
        () => initialSelectedAnimation ?? pickPreferredAnimation(initialAnimations)
    );
    const [missingTextureCount, setMissingTextureCount] = useState<number>(
        () => thumbnailEventBus.getMissingTextureCount(file.fullPath)
    );
    const cardRef = useRef<HTMLDivElement>(null);

    // 1. Subscribe to animation metadata updates. Thumbnail bitmap updates are handled
    // directly inside AnimatedPreview to avoid React re-renders on every frame.
    useEffect(() => {
        const handleAnims = (newAnims: string[]) => {
            setAnimations(newAnims);
            if (!selectedAnimation && newAnims.length > 0) {
                setSelectedAnimation(pickPreferredAnimation(newAnims) ?? newAnims[0]);
            }
        };

        thumbnailEventBus.on(`animations:${file.fullPath}`, handleAnims);

        return () => {
            thumbnailEventBus.off(`animations:${file.fullPath}`, handleAnims);
        };
    }, [file.fullPath, selectedAnimation]);

    useEffect(() => {
        const handleMissingTextures = (missCount: number) => {
            setMissingTextureCount(missCount);
        };

        setMissingTextureCount(thumbnailEventBus.getMissingTextureCount(file.fullPath));
        thumbnailEventBus.on(`missing-textures:${file.fullPath}`, handleMissingTextures);

        return () => {
            thumbnailEventBus.off(`missing-textures:${file.fullPath}`, handleMissingTextures);
        };
    }, [file.fullPath]);

    // 2. Visibility Tracking (Intersection Observer)
    useEffect(() => {
        if (!cardRef.current || !onVisibilityChange) return;

        const observer = new IntersectionObserver(
            ([entry]) => {
                onVisibilityChange(file.fullPath, entry.isIntersecting);
            },
            { threshold: 0.1 }
        );

        observer.observe(cardRef.current);
        return () => observer.disconnect();
    }, [file.fullPath, onVisibilityChange]);

    return (
        <div
            ref={cardRef}
            style={{
                position: 'relative',
                background: '#1a1a1a',
                border: '2px solid',
                borderColor: isSelected ? '#1677ff' : '#333',
                borderRadius: 8,
                padding: 4,
                transition: 'all 0.2s',
                width: fixedSize,
                height: fixedSize,
                alignSelf: 'start',
                boxSizing: 'border-box',
                cursor: 'pointer',
                overflow: 'hidden',
                flexShrink: 0
            }}
            className="model-card-hover"
            onClick={() => onSelect?.(file)}
            onDoubleClick={() => onDoubleClick?.(file)}
        >
            <div style={{
                position: 'absolute',
                inset: 4,
                background: '#000',
                borderRadius: 4,
                overflow: 'hidden',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                zIndex: 2
            }}>
                <AnimatedPreview
                    fullPath={file.fullPath}
                    isSelected={isSelected}
                />

                {missingTextureCount > 0 && (
                    <Tooltip title={`贴图缺少${missingTextureCount > 1 ? ` (${missingTextureCount})` : ''}`}>
                        <div style={{
                            position: 'absolute',
                            top: 4,
                            left: 4,
                            zIndex: 4,
                            width: 22,
                            height: 22,
                            borderRadius: 999,
                            background: 'rgba(32, 24, 0, 0.88)',
                            border: '1px solid rgba(255, 200, 64, 0.9)',
                            color: '#ffcf5a',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            boxShadow: '0 2px 8px rgba(0,0,0,0.35)'
                        }}>
                            <WarningOutlined />
                        </div>
                    </Tooltip>
                )}

                {/* Overlay Buttons */}
                <div className="card-actions" style={{
                    position: 'absolute',
                    top: 4,
                    right: 4,
                    display: 'flex',
                    gap: 4,
                    zIndex: 4,
                    opacity: 0,
                    transition: 'opacity 0.2s'
                }}>
                    <Tooltip title="复制模型">
                        <Button
                            type="text"
                            icon={<CopyOutlined style={{ color: '#fff' }} />}
                            size="small"
                            style={{ background: 'rgba(0,0,0,0.6)' }}
                            onClick={(e) => { e.stopPropagation(); onCopy?.(file); }}
                        />
                    </Tooltip>

                    <Tooltip title="修改贴图路径">
                        <Button
                            type="text"
                            icon={<FileImageOutlined style={{ color: '#fff' }} />}
                            size="small"
                            style={{ background: 'rgba(0,0,0,0.6)' }}
                            onClick={(e) => { e.stopPropagation(); onEditTexture(file); }}
                        />
                    </Tooltip>

                    <Tooltip title="删除模型">
                        <Button
                            type="text"
                            danger
                            icon={<DeleteOutlined />}
                            size="small"
                            style={{ background: 'rgba(0,0,0,0.6)' }}
                            onClick={(e) => { e.stopPropagation(); onDelete(file); }}
                        />
                    </Tooltip>
                </div>
            </div>

            <div style={{
                position: 'absolute',
                left: 8,
                right: 8,
                bottom: 8,
                zIndex: 4,
                display: 'flex',
                flexDirection: 'column',
                gap: 6
            }}>
                <Text
                    ellipsis={{ tooltip: file.name }}
                    style={{
                        textAlign: 'center',
                        fontSize: 11,
                        width: '100%',
                        color: '#e6e6e6',
                        padding: '2px 6px',
                        background: 'rgba(0,0,0,0.55)',
                        borderRadius: 4,
                        lineHeight: 1.2
                    }}
                >
                    {file.name}
                </Text>

                {/* Animation Dropdown */}
                {showAnimationSelect && animations.length > 0 && (
                    <Select
                        size="small"
                        placeholder="选择动画"
                        value={selectedAnimation}
                        onChange={(value) => {
                            setSelectedAnimation(value);
                            onAnimationChange?.(file, value);
                        }}
                        style={{ width: '100%' }}
                        options={animations.map(anim => ({ label: anim, value: anim }))}
                        onClick={(e) => e.stopPropagation()}
                    />
                )}
            </div>

            <style>{`
                .model-card-hover:hover {
                    border-color: #1677ff !important;
                    transform: translateY(-2px);
                    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                }
                .model-card-hover:hover .card-actions {
                    opacity: 1 !important;
                }
            `}</style>
        </div>
    );
});
