export type ShortcutContext = 'global' | 'view' | 'geometry' | 'uv' | 'animation' | 'batch' | 'viewer'

export interface ShortcutAction {
    id: string
    label: string
    category: string
    contexts: ShortcutContext[]
    defaultBindings: string[]
    allowInInputs?: boolean
    preventDefault?: boolean
    stopPropagation?: boolean
}

export const shortcutActions: ShortcutAction[] = [
    // File
    {
        id: 'file.open',
        label: '打开模型',
        category: '文件',
        contexts: ['global'],
        defaultBindings: ['Ctrl+O'],
        allowInInputs: true,
        preventDefault: true
    },
    {
        id: 'file.save',
        label: '保存模型',
        category: '文件',
        contexts: ['global'],
        defaultBindings: ['Ctrl+S'],
        allowInInputs: true,
        preventDefault: true
    },
    {
        id: 'file.saveAs',
        label: '另存为',
        category: '文件',
        contexts: ['global'],
        defaultBindings: ['Ctrl+Shift+S'],
        allowInInputs: true,
        preventDefault: true
    },
    {
        id: 'file.copyModel',
        label: '复制模型(含贴图)',
        category: '文件',
        contexts: ['global'],
        defaultBindings: ['Shift+C'],
        allowInInputs: true,
        preventDefault: true
    },

    // Window / Tabs
    {
        id: 'window.closeTab',
        label: '关闭当前标签',
        category: '窗口',
        contexts: ['global'],
        defaultBindings: ['Ctrl+W'],
        allowInInputs: true,
        preventDefault: true
    },
    {
        id: 'window.closeApp',
        label: '关闭窗口',
        category: '窗口',
        contexts: ['global'],
        defaultBindings: ['Alt+F4'],
        allowInInputs: true,
        preventDefault: true
    },
    {
        id: 'window.closeAppEsc',
        label: '关闭窗口(无面板时)',
        category: '窗口',
        contexts: ['global'],
        defaultBindings: ['Escape'],
        allowInInputs: true,
        preventDefault: true
    },

    // Mode
    {
        id: 'mode.view',
        label: '查看模式',
        category: '模式',
        contexts: ['global'],
        defaultBindings: ['1'],
        preventDefault: true
    },
    {
        id: 'mode.geometry',
        label: '顶点模式',
        category: '模式',
        contexts: ['global'],
        defaultBindings: ['2'],
        preventDefault: true
    },
    {
        id: 'mode.uv',
        label: 'UV 模式',
        category: '模式',
        contexts: ['global'],
        defaultBindings: ['3'],
        preventDefault: true
    },
    {
        id: 'mode.animation',
        label: '动画模式',
        category: '模式',
        contexts: ['global'],
        defaultBindings: ['4'],
        preventDefault: true
    },

    // Editors / Managers
    {
        id: 'editor.nodeManager',
        label: '节点管理器',
        category: '编辑器',
        contexts: ['global'],
        defaultBindings: ['N']
    },
    {
        id: 'editor.cameraManager',
        label: '镜头管理器',
        category: '编辑器',
        contexts: ['global'],
        defaultBindings: ['C']
    },
    {
        id: 'editor.geosetManager',
        label: '多边形管理器',
        category: '编辑器',
        contexts: ['global'],
        defaultBindings: ['G']
    },
    {
        id: 'editor.geosetAnimManager',
        label: '多边形动画管理器',
        category: '编辑器',
        contexts: ['global'],
        defaultBindings: ['U']
    },
    {
        id: 'editor.textureManager',
        label: '贴图管理器',
        category: '编辑器',
        contexts: ['global'],
        defaultBindings: ['T']
    },
    {
        id: 'editor.textureAnimManager',
        label: '贴图动画管理器',
        category: '编辑器',
        contexts: ['global'],
        defaultBindings: ['X']
    },
    {
        id: 'editor.materialManager',
        label: '材质管理器',
        category: '编辑器',
        contexts: ['global'],
        defaultBindings: ['M']
    },
    {
        id: 'editor.sequenceManager',
        label: '模型动作管理器',
        category: '编辑器',
        contexts: ['global'],
        // Avoid conflict with animation.selectChildNode (S) while in animation mode.
        defaultBindings: ['Shift+S']
    },
    {
        id: 'editor.globalSequenceManager',
        label: '全局动作管理器',
        category: '编辑器',
        contexts: ['global'],
        defaultBindings: ['L']
    },

    // View / Camera
    {
        id: 'view.perspective',
        label: '透视视图',
        category: '视图',
        contexts: ['global', 'viewer'],
        defaultBindings: ['0', 'Num0']
    },
    {
        id: 'view.orthographic',
        label: '正交视图',
        category: '视图',
        contexts: ['global', 'viewer'],
        defaultBindings: ['O']
    },
    {
        id: 'view.top',
        label: '顶视图',
        category: '视图',
        contexts: ['global', 'viewer'],
        defaultBindings: ['F3']
    },
    {
        id: 'view.bottom',
        label: '底视图',
        category: '视图',
        contexts: ['global', 'viewer'],
        defaultBindings: ['F4']
    },
    {
        id: 'view.front',
        label: '前视图',
        category: '视图',
        contexts: ['global', 'viewer'],
        defaultBindings: ['F1']
    },
    {
        id: 'view.back',
        label: '后视图',
        category: '视图',
        contexts: ['global', 'viewer'],
        defaultBindings: ['F2']
    },
    {
        id: 'view.left',
        label: '左视图',
        category: '视图',
        contexts: ['global', 'viewer'],
        defaultBindings: ['F5']
    },
    {
        id: 'view.right',
        label: '右视图',
        category: '视图',
        contexts: ['global', 'viewer'],
        defaultBindings: ['F6']
    },
    {
        id: 'view.fitToView',
        label: '适配视图',
        category: '视图',
        contexts: ['viewer'],
        defaultBindings: ['Z'],
        preventDefault: true
    },
    {
        id: 'view.toggleWireframe',
        label: '切换线框/纹理',
        category: '视图',
        contexts: ['viewer'],
        defaultBindings: ['F'],
        preventDefault: true
    },
    {
        id: 'view.toggleVertices',
        label: '切换顶点显示',
        category: '视图',
        contexts: ['global', 'viewer'],
        defaultBindings: ['V']
    },
    {
        id: 'view.cameraViewToggle',
        label: '切换模型相机视角',
        category: '视图',
        contexts: ['viewer'],
        defaultBindings: ['Backquote']
    },

    // Animation
    {
        id: 'animation.playPause',
        label: '播放/暂停动画',
        category: '动画',
        contexts: ['view', 'geometry', 'uv', 'animation'],
        defaultBindings: ['Space'],
        preventDefault: true
    },
    {
        id: 'animation.prevSequence',
        label: '\u4e0a\u4e00\u4e2a\u64ad\u653e\u52a8\u4f5c',
        category: '动画',
        contexts: ['view', 'geometry', 'uv', 'animation'],
        defaultBindings: ['ArrowUp'],
        preventDefault: true
    },
    {
        id: 'animation.nextSequence',
        label: '\u4e0b\u4e00\u4e2a\u64ad\u653e\u52a8\u4f5c',
        category: '动画',
        contexts: ['view', 'geometry', 'uv', 'animation'],
        defaultBindings: ['ArrowDown'],
        preventDefault: true
    },
    {
        id: 'animation.selectParentNode',
        label: '选取父节点',
        category: '动画',
        contexts: ['animation'],
        defaultBindings: ['A'],
        preventDefault: true
    },
    {
        id: 'animation.selectChildNode',
        label: '选取子节点',
        category: '动画',
        contexts: ['animation'],
        defaultBindings: ['S'],
        preventDefault: true
    },

    // Edit
    {
        id: 'edit.undo',
        label: '撤销',
        category: '编辑',
        contexts: ['global'],
        defaultBindings: ['Ctrl+Z'],
        preventDefault: true
    },
    {
        id: 'edit.redo',
        label: '重做',
        category: '编辑',
        contexts: ['global'],
        defaultBindings: ['Ctrl+Y', 'Ctrl+Shift+Z'],
        preventDefault: true
    },

    // Transform
    {
        id: 'transform.translate',
        label: '移动模式',
        category: '变换',
        contexts: ['viewer', 'geometry', 'animation', 'view', 'uv'],
        defaultBindings: ['W']
    },
    {
        id: 'transform.rotate',
        label: '旋转模式',
        category: '变换',
        contexts: ['viewer', 'geometry', 'animation', 'view', 'uv'],
        defaultBindings: ['E']
    },
    {
        id: 'transform.scale',
        label: '缩放模式',
        category: '变换',
        contexts: ['viewer', 'geometry', 'animation', 'view', 'uv'],
        defaultBindings: ['R']
    },

    // Geometry - Vertex operations
    {
        id: 'geometry.copyVertices',
        label: '复制顶点',
        category: '几何',
        contexts: ['geometry'],
        defaultBindings: ['Ctrl+C'],
        preventDefault: true
    },
    {
        id: 'geometry.pasteVertices',
        label: '粘贴顶点',
        category: '几何',
        contexts: ['geometry'],
        defaultBindings: ['Ctrl+V'],
        preventDefault: true
    },
    {
        id: 'geometry.deleteVertices',
        label: '删除顶点',
        category: '几何',
        contexts: ['geometry'],
        defaultBindings: ['Delete'],
        preventDefault: true
    },

    // Timeline - Keyframes
    {
        id: 'timeline.copyKeyframes',
        label: '复制关键帧',
        category: '时间轴',
        contexts: ['animation'],
        defaultBindings: ['Ctrl+C'],
        preventDefault: true
    },
    {
        id: 'timeline.cutKeyframes',
        label: '剪切关键帧',
        category: '时间轴',
        contexts: ['animation'],
        defaultBindings: ['Ctrl+X'],
        preventDefault: true
    },
    {
        id: 'timeline.pasteKeyframes',
        label: '粘贴关键帧',
        category: '时间轴',
        contexts: ['animation'],
        defaultBindings: ['Ctrl+V'],
        preventDefault: true
    },
    {
        id: 'timeline.deleteKeyframes',
        label: '删除关键帧',
        category: '时间轴',
        contexts: ['animation'],
        defaultBindings: ['Delete'],
        preventDefault: true
    },
    {
        id: 'timeline.quickKeyframe',
        label: '\u5feb\u901fK\u5e27\uff08\u4f4d\u79fb/\u65cb\u8f6c/\u7f29\u653e\uff09',
        category: '\u65f6\u95f4\u8f74',
        contexts: ['animation'],
        defaultBindings: ['K'],
        preventDefault: true
    },

    // Batch
    {
        id: 'batch.copyModel',
        label: '复制批处理模型',
        category: '批量',
        contexts: ['batch'],
        defaultBindings: ['Ctrl+C'],
        preventDefault: true
    }
]

export const shortcutActionMap = new Map(shortcutActions.map((action) => [action.id, action]))
