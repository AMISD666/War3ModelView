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
    // 不使用JSX，使用 createElement 避免解析器问题
    const iconStyle = (color: string) => ({ fontSize: 14, color });

    const Icon = ApartmentOutlined;

    switch (type) {
        case NodeType.BONE:
            return React.createElement(Icon, { style: iconStyle('#52c41a') });
        case NodeType.HELPER:
            return React.createElement(Icon, { style: iconStyle('#1890ff') });
        case NodeType.ATTACHMENT:
            return React.createElement(Icon, { style: iconStyle('#faad14') });
        case NodeType.LIGHT:
            return React.createElement(Icon, { style: iconStyle('#ffec3d') });
        case NodeType.PARTICLE_EMITTER:
        case NodeType.PARTICLE_EMITTER_2:
            return React.createElement(Icon, { style: iconStyle('#f759ab') });
        case NodeType.RIBBON_EMITTER:
            return React.createElement(Icon, { style: iconStyle('#9254de') });
        case NodeType.EVENT_OBJECT:
            return React.createElement(Icon, { style: iconStyle('#ff4d4f') });
        case NodeType.COLLISION_SHAPE:
            return React.createElement(Icon, { style: iconStyle('#722ed1') });
        case NodeType.CAMERA:
            return React.createElement(Icon, { style: iconStyle('#13c2c2') });
        default:
            return React.createElement(Icon, { style: { fontSize: 14 } });
    }
}

/**
 * 获取节点类型的中文名称
 */
export function getNodeTypeName(type: NodeType): string {
    const typeNames: Record<NodeType, string> = {
        [NodeType.BONE]: '骨骼',
        [NodeType.HELPER]: '辅助点',
        [NodeType.ATTACHMENT]: '附加点',
        [NodeType.LIGHT]: '光源',
        [NodeType.PARTICLE_EMITTER]: '粒子发射器',
        [NodeType.PARTICLE_EMITTER_2]: '粒子发射器2',
        [NodeType.RIBBON_EMITTER]: '带状发射器',
        [NodeType.EVENT_OBJECT]: '事件对象',
        [NodeType.COLLISION_SHAPE]: '碰撞体',
        [NodeType.CAMERA]: '相机'
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
