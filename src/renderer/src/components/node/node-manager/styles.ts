import type { CSSProperties } from 'react';

export const NODE_MANAGER_STYLE = `
                .node-manager-tree-wrapper, .node-manager-tree-wrapper * {
                    -webkit-app-region: no-drag !important;
                    user-select: none;
                }
                .ant-tree-treenode {
                    -webkit-user-drag: element;
                }
            `;

export const rootStyle: CSSProperties = {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    padding: '8px',
    overflow: 'hidden'
};

export const searchStyle: CSSProperties = {
    marginBottom: 8
};

export const getTreeWrapperStyle = (treeViewportHeight: number): CSSProperties => ({
    flex: 1,
    overflow: treeViewportHeight > 0 ? 'hidden' : 'auto',
    border: '1px solid #303030',
    borderRadius: '2px',
    backgroundColor: '#1e1e1e',
    padding: '4px',
    outline: 'none'
});

export const emptyTreeStyle: CSSProperties = {
    textAlign: 'center',
    padding: '20px',
    color: '#888'
};

export const contextMenuPopoverStyle = (x: number, y: number): CSSProperties => ({
    position: 'fixed',
    left: x,
    top: y,
    zIndex: 1000,
    backgroundColor: '#1f1f1f',
    border: '1px solid #303030',
    borderRadius: '2px',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.5)',
    maxHeight: 'calc(100vh - 16px)',
    overflowY: 'auto'
});

export const contextMenuStyle: CSSProperties = {
    border: 'none'
};

export const nodeTitleTextStyle = (isVirtualRoot: boolean, isNodeVisible: boolean): CSSProperties => ({
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    minWidth: 0,
    fontWeight: isVirtualRoot ? 'bold' : 'normal',
    color: isVirtualRoot ? '#1890ff' : 'inherit',
    opacity: isNodeVisible ? 1 : 0.55
});

export const nodeObjectIdStyle: CSSProperties = {
    color: '#666',
    fontSize: '10px',
    marginLeft: '6px'
};

export const getNodeRowStyle = (params: {
    isVirtualRoot: boolean;
    isDraggingThis: boolean;
    isDropTarget: boolean;
    isCut: boolean;
}): CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    width: '100%',
    minWidth: 0,
    padding: 0,
    height: 18,
    cursor: params.isVirtualRoot ? 'default' : (params.isDraggingThis ? 'grabbing' : 'grab'),
    borderRadius: '2px',
    backgroundColor: params.isDropTarget
        ? 'rgba(24, 144, 255, 0.3)'
        : (params.isVirtualRoot ? 'rgba(80, 80, 80, 0.3)' : 'transparent'),
    border: params.isDropTarget ? '1px dashed #1890ff' : '1px solid transparent',
    opacity: params.isDraggingThis ? 0.5 : (params.isCut ? 0.5 : 1),
    transition: 'background-color 0.15s, border 0.15s',
    userSelect: 'none'
});
