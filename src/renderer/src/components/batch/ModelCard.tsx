import React from 'react';
import { Button, Typography, Tooltip, Popconfirm, Select } from 'antd';
import { DeleteOutlined, FileImageOutlined } from '@ant-design/icons';
import { AnimatedPreview } from './AnimatedPreview';

const { Text } = Typography;

interface ModelFile {
    name: string;
    path: string;
    fullPath: string;
}

interface ModelCardProps {
    file: ModelFile;
    thumbnail?: string;
    animations?: string[];
    selectedAnimation?: string;
    isSelected?: boolean;
    onDelete: (file: ModelFile) => void;
    onEditTexture: (file: ModelFile) => void;
    onAnimationChange?: (file: ModelFile, animation: string) => void;
    onSelect?: (file: ModelFile) => void;
}

export const ModelCard: React.FC<ModelCardProps> = ({
    file,
    thumbnail,
    animations = [],
    selectedAnimation,
    isSelected = false,
    onDelete,
    onEditTexture,
    onAnimationChange,
    onSelect
}) => {
    return (
        <div
            style={{
                position: 'relative',
                background: '#1a1a1a',
                border: isSelected ? '2px solid #1677ff' : '1px solid #333',
                borderRadius: 8,
                padding: 8,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                transition: 'all 0.2s',
                height: 'fit-content',
                cursor: 'pointer',
            }}
            className="model-card-hover"
            onClick={() => onSelect?.(file)}
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
                {/* NOTE: AnimatedPreview is temporarily disabled.
                    The war3-model library uses shared global state for WebGL resources.
                    Creating multiple ModelRenderer instances (main viewer + preview) corrupts
                    the shared state and causes 'bindTexture: object does not belong to this context' errors.
                    Using static thumbnails until a proper isolation solution is implemented. */}
                {thumbnail ? (
                    <img
                        src={thumbnail}
                        alt={file.name}
                        style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'contain',
                            border: isSelected ? '2px solid #1677ff' : 'none',
                            boxSizing: 'border-box'
                        }}
                        draggable={false}
                    />
                ) : (
                    <div style={{ fontSize: 24, color: '#666', fontWeight: 'bold' }}>MDX</div>
                )}

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
                    <Tooltip title="修改贴图路径">
                        <Button
                            type="text"
                            icon={<FileImageOutlined style={{ color: '#fff' }} />}
                            size="small"
                            style={{ background: 'rgba(0,0,0,0.6)' }}
                            onClick={(e) => { e.stopPropagation(); onEditTexture(file); }}
                        />
                    </Tooltip>

                    <Popconfirm
                        title="确定删除模型文件?"
                        description="这也将尝试删除同名的预览图(如果有)"
                        onConfirm={(e) => { e?.stopPropagation(); onDelete(file); }}
                        onCancel={(e) => e?.stopPropagation()}
                        okText="删除"
                        cancelText="取消"
                    >
                        <Button
                            type="text"
                            danger
                            icon={<DeleteOutlined />}
                            size="small"
                            style={{ background: 'rgba(0,0,0,0.6)' }}
                            onClick={(e) => e.stopPropagation()}
                        />
                    </Popconfirm>
                </div>
            </div>

            <Text
                ellipsis={{ tooltip: file.name }}
                style={{
                    textAlign: 'center',
                    fontSize: 12,
                    width: '100%',
                    color: '#ccc'
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
                    onChange={(value) => onAnimationChange?.(file, value)}
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
};
