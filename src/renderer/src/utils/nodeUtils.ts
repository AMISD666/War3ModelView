/**
 * Node Utility Functions
 */

import React from 'react';
import { ApartmentOutlined } from '@ant-design/icons';
import { NodeType } from '../types/node';

/**
 * 获取节点类型对应的图标
 */
export function getNodeIcon(type: NodeType): React.ReactNode {
    return React.createElement(NodeTypeIcon, { type });
}

export function getVirtualRootIcon(): React.ReactNode {
    return React.createElement(NodeIconImage, {
        alt: 'root',
        src: iconUrl('root.svg'),
        fallbackColor: '#1890ff',
    });
}

export function isNodeManagerType(type: NodeType): boolean {
    switch (type) {
        case NodeType.ATTACHMENT:
        case NodeType.BONE:
        case NodeType.COLLISION_SHAPE:
        case NodeType.EVENT_OBJECT:
        case NodeType.HELPER:
        case NodeType.LIGHT:
        case NodeType.PARTICLE_EMITTER:
        case NodeType.PARTICLE_EMITTER_2:
        case NodeType.RIBBON_EMITTER:
            return true;
        default:
            return false;
    }
}

const NODE_ICON_SIZE = 14;

function iconUrl(file: string): string {
    // Vite: respects BASE_URL (e.g. when packaged under a sub-path).
    const baseUrl = (import.meta as any).env?.BASE_URL ?? '/';
    const prefix = typeof baseUrl === 'string' && baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    return `${prefix}node-icons/${file}`;
}

function fallbackColorForType(type: NodeType): string {
    switch (type) {
        case NodeType.BONE: return '#52c41a';
        case NodeType.HELPER: return '#1890ff';
        case NodeType.ATTACHMENT: return '#faad14';
        case NodeType.LIGHT: return '#ffec3d';
        case NodeType.PARTICLE_EMITTER:
        case NodeType.PARTICLE_EMITTER_2: return '#f759ab';
        case NodeType.PARTICLE_EMITTER_POPCORN: return '#ff7a45';
        case NodeType.RIBBON_EMITTER: return '#9254de';
        case NodeType.EVENT_OBJECT: return '#ff4d4f';
        case NodeType.COLLISION_SHAPE: return '#722ed1';
        case NodeType.CAMERA: return '#13c2c2';
        default: return '#aaa';
    }
}

function iconFileForType(type: NodeType): string {
    switch (type) {
        case NodeType.BONE: return 'bone.svg';
        case NodeType.HELPER: return 'helper.svg';
        case NodeType.ATTACHMENT: return 'attachment.svg';
        case NodeType.LIGHT: return 'light.svg';
        case NodeType.PARTICLE_EMITTER: return 'particle.svg';
        case NodeType.PARTICLE_EMITTER_2: return 'particle2.svg';
        case NodeType.PARTICLE_EMITTER_POPCORN: return 'popcorn.svg';
        case NodeType.RIBBON_EMITTER: return 'ribbon.svg';
        case NodeType.EVENT_OBJECT: return 'event.svg';
        case NodeType.COLLISION_SHAPE: return 'collision.svg';
        case NodeType.CAMERA: return 'camera.svg';
        default: return 'default.svg';
    }
}

function NodeTypeIcon({ type }: { type: NodeType }): React.ReactElement {
    return React.createElement(NodeIconImage, {
        alt: String(type),
        src: iconUrl(iconFileForType(type)),
        fallbackColor: fallbackColorForType(type),
    });
}

function NodeIconImage(
    { src, alt, fallbackColor }: { src: string; alt: string; fallbackColor: string }
): React.ReactElement {
    const [broken, setBroken] = React.useState(false);

    if (broken) {
        return React.createElement(ApartmentOutlined, { style: { fontSize: NODE_ICON_SIZE, color: fallbackColor } });
    }

    return React.createElement('img', {
        src,
        alt,
        width: NODE_ICON_SIZE,
        height: NODE_ICON_SIZE,
        draggable: false,
        style: {
            width: NODE_ICON_SIZE,
            height: NODE_ICON_SIZE,
            display: 'block',
            objectFit: 'contain',
            imageRendering: '-webkit-optimize-contrast',
        } as any,
        onError: () => setBroken(true),
    });
}

/**
 * 获取节点类型的中文名称
 */
export function getNodeTypeName(type: NodeType): string {
    const typeNames: Record<NodeType, string> = {
        [NodeType.BONE]: '骨骼',
        [NodeType.HELPER]: '帮助体',
        [NodeType.ATTACHMENT]: '附着体',
        [NodeType.LIGHT]: '光源',
        [NodeType.PARTICLE_EMITTER]: '粒子发射器1',
        [NodeType.PARTICLE_EMITTER_2]: '2型粒子发射器',
        [NodeType.RIBBON_EMITTER]: '丝带发射器',
        [NodeType.EVENT_OBJECT]: '事件物体',
        [NodeType.COLLISION_SHAPE]: '点击球',
        [NodeType.CAMERA]: '相机',
        [NodeType.PARTICLE_EMITTER_POPCORN]: 'Popcorn粒子发射器'
    };

    return typeNames[type] || '未知';
}

/**
 * 生成新的唯一 ObjectId
 */
export function generateObjectId(existingIds: number[]): number {
    if (existingIds.length === 0) return 0;
    return Math.max(...existingIds) + 1;
}

/**
 * 验证节点名称
 */
export function validateNodeName(name: string): { valid: boolean; error?: string } {
    if (!name || name.trim().length === 0) {
        return { valid: false, error: '节点名称不能为空' };
    }

    if (name.length > 80) {
        return { valid: false, error: '节点名称不能超过80个字符' };
    }

    return { valid: true };
}

/**
 * 检查节点是否可以删除
 */
export function canDeleteNode(
    nodeId: number,
    allNodes: any[],
    geosets?: any[]
): { canDelete: boolean; reason?: string } {
    // 检查是否有子节点
    const hasChildren = allNodes.some(node => node.Parent === nodeId);
    if (hasChildren) {
        return {
            canDelete: false,
            reason: '该节点有子节点，请先删除子节点'
        };
    }

    // 检查是否被 Geoset 引用
    if (geosets) {
        const isReferenced = geosets.some(geoset => geoset.GeosetId === nodeId);
        if (isReferenced) {
            return {
                canDelete: false,
                reason: '该节点被 Geoset 引用，无法删除'
            };
        }
    }

    return { canDelete: true };
}
