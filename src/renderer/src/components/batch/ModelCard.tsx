import React, { useState, useEffect, useRef } from 'react';
import { Button, Typography, Tooltip, Select } from 'antd';
import { DeleteOutlined, FileImageOutlined, CopyOutlined } from '@ant-design/icons';
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
    isSelected?: boolean;
    onDelete: (file: ModelFile) => void;
    onEditTexture: (file: ModelFile) => void;
    onCopy?: (file: ModelFile) => void;
    onAnimationChange?: (file: ModelFile, animation: string) => void;
    onSelect?: (file: ModelFile) => void;
    onDoubleClick?: (file: ModelFile) => void;
    onVisibilityChange?: (fullPath: string, isVisible: boolean) => void;
}

export const ModelCard: React.FC<ModelCardProps> = React.memo(({
    file,
    initialAnimations = [],
    initialSelectedAnimation,
    isSelected = false,
    onDelete,
    onEditTexture,
    onCopy,
    onAnimationChange,
    onSelect,
    onDoubleClick,
    onVisibilityChange
}) => {
    const [bitmap, setBitmap] = useState<ImageBitmap | null>(thumbnailEventBus.getBitmap(file.fullPath) || null);
    const [animations, setAnimations] = useState<string[]>(initialAnimations);
    const [selectedAnimation, setSelectedAnimation] = useState<string | undefined>(initialSelectedAnimation);
    const cardRef = useRef<HTMLDivElement>(null);

    // 1. Subscribe to Thumbnail Updates (Bypass parent re-render)
    useEffect(() => {
        const handleUpdate = (newBitmap: ImageBitmap) => {
            setBitmap(newBitmap);
        };
        const handleAnims = (newAnims: string[]) => {
            setAnimations(newAnims);
            if (!selectedAnimation && newAnims.length > 0) {
                setSelectedAnimation(newAnims[0]);
            }
        };

        thumbnailEventBus.on(`update:${file.fullPath}`, handleUpdate);
        thumbnailEventBus.on(`animations:${file.fullPath}`, handleAnims);

        return () => {
            thumbnailEventBus.off(`update:${file.fullPath}`, handleUpdate);
            thumbnailEventBus.off(`animations:${file.fullPath}`, handleAnims);
        };
    }, [file.fullPath, selectedAnimation]);

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
                border: isSelected ? '2px solid #1677ff' : '1px solid #333',
                borderRadius: 8,
                padding: 4,
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                transition: 'all 0.2s',
                height: 'fit-content',
                cursor: 'pointer',
            }}
            className="model-card-hover"
            onClick={() => onSelect?.(file)}
            onDoubleClick={() => onDoubleClick?.(file)}
        >
            <div style={{
                width: '100%',
                aspectRatio: '1',
                background: '#000',
                borderRadius: 4,
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                overflow: 'hidden',
                position: 'relative'
            }}>
                <AnimatedPreview
                    bitmap={bitmap}
                    isSelected={isSelected}
                />

                {/* Overlay Buttons */}
                <div className="card-actions" style={{
                    position: 'absolute',
                    top: 4,
                    right: 4,
                    display: 'flex',
                    gap: 4,
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

            <Text
                ellipsis={{ tooltip: file.name }}
                style={{
                    textAlign: 'center',
                    fontSize: 11,
                    width: '100%',
                    color: '#ccc',
                    padding: '0 2px'
                }}
            >
                {file.name}
            </Text>

            {/* Animation Dropdown */}
            {animations.length > 0 && (
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
