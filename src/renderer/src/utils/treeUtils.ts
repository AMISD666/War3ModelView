/**
 * Tree Data Utility Functions
 */

import { ModelNode, TreeNode } from '../types/node';
import { getNodeIcon, getVirtualRootIcon } from './nodeUtils';

/**
 * 将扁平的节点数组转换为树形结构
 * 添加一个虚拟根节点（ObjectId = -1）作为所有顶级节点的父节点
 */
export function buildTreeData(nodes: ModelNode[]): TreeNode[] {
    const uniqueNodes = Array.from(
        nodes.reduce((map, node) => {
            if (typeof node?.ObjectId !== 'number' || Number.isNaN(node.ObjectId)) {
                return map;
            }
            if (!map.has(node.ObjectId)) {
                map.set(node.ObjectId, node);
            }
            return map;
        }, new Map<number, ModelNode>()).values()
    );
    const nodeMap = new Map<number, TreeNode>();
    const rootNodes: TreeNode[] = [];

    // 第一遍：创建所有树节点
    uniqueNodes.forEach(node => {
        const objectId = node.ObjectId ?? 0;  // 确保 ObjectId 有值
        const treeNode: TreeNode = {
            key: String(objectId),
            value: objectId,  // 确保 value 始终有效
            title: node.Name || `未命名节点 ${objectId}`,
            type: node.type,
            icon: getNodeIcon(node.type),
            children: [],
            data: node
        };
        nodeMap.set(objectId, treeNode);
    });

    // 第二遍：建立父子关系
    uniqueNodes.forEach(node => {
        const treeNode = nodeMap.get(node.ObjectId);
        if (!treeNode) return;

        if (node.Parent !== undefined && node.Parent !== -1) {
            const parent = nodeMap.get(node.Parent);
            if (parent && parent.children) {
                parent.children.push(treeNode);
            } else {
                // 父节点不存在，作为根节点
                rootNodes.push(treeNode);
            }
        } else {
            // 没有父节点，是根节点
            rootNodes.push(treeNode);
        }
    });

    // 如果没有节点，直接返回空数组
    if (uniqueNodes.length === 0) {
        return [];
    }

    // 创建虚拟根节点，包含所有顶级节点
    const virtualRootNode: TreeNode = {
        key: '-1',
        value: -1,
        title: '模型根节点',
        type: undefined as any,  // 虚拟节点没有类型
        icon: getVirtualRootIcon(),
        children: rootNodes,
        data: { ObjectId: -1, Name: '模型根节点', Parent: undefined } as any,
        isVirtualRoot: true  // 标记为虚拟根节点
    };

    return [virtualRootNode];
}

/**
 * 过滤树节点（搜索功能）
 */
export function filterTreeNodes(
    nodes: TreeNode[],
    searchText: string
): TreeNode[] {
    if (!searchText) return nodes;

    const lowerSearch = searchText.toLowerCase();

    return nodes.reduce<TreeNode[]>((acc, node) => {
        const matchesSearch = node.title.toLowerCase().includes(lowerSearch);
        const filteredChildren = node.children
            ? filterTreeNodes(node.children, searchText)
            : [];

        if (matchesSearch || filteredChildren.length > 0) {
            acc.push({
                ...node,
                children: filteredChildren.length > 0 ? filteredChildren : node.children
            });
        }

        return acc;
    }, []);
}

/**
 * 展开所有包含搜索结果的节点
 */
export function getExpandedKeys(
    nodes: TreeNode[],
    searchText: string
): string[] {
    if (!searchText) return [];

    const expandedKeys: string[] = [];
    const lowerSearch = searchText.toLowerCase();

    function traverse(node: TreeNode) {
        if (node.children && node.children.length > 0) {
            const hasMatchingChild = node.children.some(child =>
                child.title.toLowerCase().includes(lowerSearch)
            );

            if (hasMatchingChild) {
                expandedKeys.push(node.key);
            }

            node.children.forEach(child => traverse(child));
        }
    }

    nodes.forEach(node => traverse(node));
    return expandedKeys;
}

/**
 * 获取节点的所有祖先节点的 keys（用于展开到选中节点）
 */
export function getAncestorKeys(
    nodes: ModelNode[],
    targetId: number
): string[] {
    const keys: string[] = [];
    let currentId: number | undefined = targetId;

    while (currentId !== undefined) {
        const node = nodes.find(n => n.ObjectId === currentId);
        if (!node || node.Parent === undefined || node.Parent === -1) break;

        keys.push(String(node.Parent));
        currentId = node.Parent;
    }

    return keys;
}
