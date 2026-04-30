import type { TreeNode } from '../../../types/node';

export const collectTreeKeys = (data: TreeNode[]): string[] => {
    const keys: string[] = [];

    const walk = (items: TreeNode[]) => {
        items.forEach((item) => {
            keys.push(String(item.key));
            if (item.children && item.children.length > 0) {
                walk(item.children);
            }
        });
    };

    walk(data);
    return keys;
};

export const collectDescendantKeys = (node: TreeNode): string[] => {
    const keys: string[] = [];

    const walk = (items?: TreeNode[]) => {
        items?.forEach((item) => {
            keys.push(String(item.key));
            walk(item.children);
        });
    };

    walk(node.children);
    return keys;
};

export const findTreeNode = (data: TreeNode[], nodeId: number): TreeNode | null => {
    for (const item of data) {
        if (item.key === String(nodeId)) return item;
        if (item.children) {
            const found = findTreeNode(item.children, nodeId);
            if (found) return found;
        }
    }
    return null;
};
