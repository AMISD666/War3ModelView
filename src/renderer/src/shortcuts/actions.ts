import { retargetShortcutActions } from './retargetActions'

export type ShortcutContext = 'global' | 'view' | 'geometry' | 'uv' | 'animation' | 'retarget' | 'viewer'

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

const modeAction = (id: string, label: string, key: string): ShortcutAction => ({
    id,
    label,
    category: '模式',
    contexts: ['global'],
    defaultBindings: [key],
    preventDefault: true
})

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
    modeAction('mode.view', '查看模式', '1'),
    modeAction('mode.geometry', '顶点模式', '2'),
    modeAction('mode.uv', 'UV 模式', '3'),
    modeAction('mode.animation', '动画模式', '4'),
    modeAction('mode.retarget', '套动作模式', '5'),

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
        label: '多边形组管理器',
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
        id: 'view.toggleProjection',
        label: '切换透视/正交视图',
        category: '视图',
        contexts: ['global', 'viewer'],
        defaultBindings: ['Backquote', 'Shift+Backquote'],
        preventDefault: true,
        stopPropagation: true
    },
    {
        id: 'view.perspective',
        label: '透视视图',
        category: '视图',
        contexts: ['global', 'viewer'],
        defaultBindings: []
    },
    {
        id: 'view.orthographic',
        label: '正交视图',
        category: '视图',
        contexts: ['global', 'viewer'],
        defaultBindings: []
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
        label: '切换纹理/线框/叠加',
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
        defaultBindings: ['Tab'],
        preventDefault: true,
        stopPropagation: true
    },
    {
        id: 'view.gizmoOrientationWorld',
        label: '世界坐标朝向',
        category: '视图',
        contexts: ['view', 'geometry', 'animation'],
        defaultBindings: [],
        preventDefault: true
    },
    {
        id: 'view.gizmoOrientationCamera',
        label: '镜头朝向',
        category: '视图',
        contexts: ['view', 'geometry', 'animation'],
        defaultBindings: [],
        preventDefault: true
    },
    {
        id: 'view.snapTranslateToggle',
        label: '切换距离捕捉',
        category: '视图',
        contexts: ['view', 'geometry', 'uv', 'animation'],
        defaultBindings: [],
        preventDefault: true
    },
    {
        id: 'view.snapRotateToggle',
        label: '切换角度捕捉',
        category: '视图',
        contexts: ['view', 'geometry', 'uv', 'animation'],
        defaultBindings: [],
        preventDefault: true
    },
    {
        id: 'view.globalTransformToggle',
        label: '切换全局变换模式',
        category: '视图',
        contexts: ['view'],
        defaultBindings: [],
        preventDefault: true
    },
    {
        id: 'view.mirrorHorizontal',
        label: '模型左右镜像',
        category: '视图',
        contexts: ['view'],
        defaultBindings: [],
        preventDefault: true
    },
    {
        id: 'view.mirrorVertical',
        label: '模型垂直镜像',
        category: '视图',
        contexts: ['view'],
        defaultBindings: [],
        preventDefault: true
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
        label: '上一个播放动作',
        category: '动画',
        contexts: ['view', 'geometry', 'uv', 'animation'],
        defaultBindings: ['ArrowUp'],
        preventDefault: true
    },
    {
        id: 'animation.nextSequence',
        label: '下一个播放动作',
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
    {
        id: 'animation.modeBinding',
        label: '动画绑定模式',
        category: '动画',
        contexts: ['animation'],
        defaultBindings: [],
        preventDefault: true
    },
    {
        id: 'animation.modeKeyframe',
        label: '动画关键帧模式',
        category: '动画',
        contexts: ['animation'],
        defaultBindings: [],
        preventDefault: true
    },
    {
        id: 'animation.bindingVertexMode',
        label: '绑定点模式',
        category: '动画',
        contexts: ['animation'],
        defaultBindings: [],
        preventDefault: true
    },
    {
        id: 'animation.bindingGroupMode',
        label: '绑定组模式',
        category: '动画',
        contexts: ['animation'],
        defaultBindings: [],
        preventDefault: true
    },
    {
        id: 'animation.bindingExpandSelection',
        label: '绑定扩选',
        category: '动画',
        contexts: ['animation'],
        defaultBindings: [],
        preventDefault: true
    },
    {
        id: 'animation.bindingShrinkSelection',
        label: '绑定缩选',
        category: '动画',
        contexts: ['animation'],
        defaultBindings: [],
        preventDefault: true
    },
    {
        id: 'animation.createBone',
        label: '创建骨骼',
        category: '动画',
        contexts: ['animation'],
        defaultBindings: [],
        preventDefault: true
    },
    {
        id: 'animation.bindVertices',
        label: '绑定顶点到骨骼',
        category: '动画',
        contexts: ['animation'],
        defaultBindings: [],
        preventDefault: true
    },
    {
        id: 'animation.exclusiveBindVertices',
        label: '完全绑定顶点',
        category: '动画',
        contexts: ['animation'],
        defaultBindings: [],
        preventDefault: true
    },
    {
        id: 'animation.unbindVertices',
        label: '解除顶点绑定',
        category: '动画',
        contexts: ['animation'],
        defaultBindings: [],
        preventDefault: true
    },
    {
        id: 'animation.pickParent',
        label: '修改骨骼父节点',
        category: '动画',
        contexts: ['animation'],
        defaultBindings: [],
        preventDefault: true
    },

    ...retargetShortcutActions,

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
    {
        id: 'uv.transform.select',
        label: 'UV 框选/选择',
        category: 'UV',
        contexts: ['uv'],
        defaultBindings: [],
        preventDefault: true
    },

    // Geometry - Vertex operations
    {
        id: 'geometry.modeVertex',
        label: '顶点模式',
        category: '多边形组',
        contexts: ['geometry'],
        defaultBindings: [],
        preventDefault: true
    },
    {
        id: 'geometry.modeFace',
        label: '面模式',
        category: '多边形组',
        contexts: ['geometry'],
        defaultBindings: [],
        preventDefault: true
    },
    {
        id: 'geometry.modeGroup',
        label: '组模式',
        category: '多边形组',
        contexts: ['geometry'],
        defaultBindings: [],
        preventDefault: true
    },
    {
        id: 'geometry.recalculateNormals',
        label: '重算法线',
        category: '多边形组',
        contexts: ['geometry'],
        defaultBindings: [],
        preventDefault: true
    },
    {
        id: 'geometry.autoSeparateLayers',
        label: '一键智能分层',
        category: '多边形组',
        contexts: ['geometry'],
        defaultBindings: [],
        preventDefault: true
    },
    {
        id: 'geometry.togglePasteTarget',
        label: '切换粘贴到新多边形组',
        category: '多边形组',
        contexts: ['geometry'],
        defaultBindings: [],
        preventDefault: true
    },
    {
        id: 'geometry.copyVertices',
        label: '复制顶点',
        category: '多边形组',
        contexts: ['geometry'],
        defaultBindings: ['Ctrl+C'],
        preventDefault: true
    },
    {
        id: 'geometry.pasteVertices',
        label: '粘贴顶点',
        category: '多边形组',
        contexts: ['geometry'],
        defaultBindings: ['Ctrl+V'],
        preventDefault: true
    },
    {
        id: 'geometry.deleteVertices',
        label: '删除顶点',
        category: '多边形组',
        contexts: ['geometry'],
        defaultBindings: ['Delete'],
        preventDefault: true
    },
    {
        id: 'geometry.splitVertices',
        label: '分离选中顶点/面',
        category: '多边形组',
        contexts: ['geometry'],
        defaultBindings: [],
        preventDefault: true
    },
    {
        id: 'geometry.weldVertices',
        label: '焊接选中顶点',
        category: '多边形组',
        contexts: ['geometry'],
        defaultBindings: [],
        preventDefault: true
    },

    // UV
    {
        id: 'uv.modeVertex',
        label: 'UV 选择顶点',
        category: 'UV',
        contexts: ['uv'],
        defaultBindings: [],
        preventDefault: true
    },
    {
        id: 'uv.modeEdge',
        label: 'UV 选择边',
        category: 'UV',
        contexts: ['uv'],
        defaultBindings: [],
        preventDefault: true
    },
    {
        id: 'uv.modeFace',
        label: 'UV 选择面',
        category: 'UV',
        contexts: ['uv'],
        defaultBindings: [],
        preventDefault: true
    },
    {
        id: 'uv.modeGroup',
        label: 'UV 选择组',
        category: 'UV',
        contexts: ['uv'],
        defaultBindings: [],
        preventDefault: true
    },
    {
        id: 'uv.modeBlock',
        label: 'UV 选择块',
        category: 'UV',
        contexts: ['uv'],
        defaultBindings: [],
        preventDefault: true
    },
    {
        id: 'uv.mirrorHorizontal',
        label: 'UV 水平镜像',
        category: 'UV',
        contexts: ['uv'],
        defaultBindings: [],
        preventDefault: true
    },
    {
        id: 'uv.mirrorVertical',
        label: 'UV 垂直镜像',
        category: 'UV',
        contexts: ['uv'],
        defaultBindings: [],
        preventDefault: true
    },
    {
        id: 'uv.fitToView',
        label: 'UV 适应视图',
        category: 'UV',
        contexts: ['uv'],
        defaultBindings: [],
        preventDefault: true
    },
    {
        id: 'uv.toggleViewerSelectionHighlight',
        label: '切换 3D 选区高亮',
        category: 'UV',
        contexts: ['uv'],
        defaultBindings: [],
        preventDefault: true
    },
    {
        id: 'uv.toggleModelView',
        label: '显示/隐藏 UV 3D 视图',
        category: 'UV',
        contexts: ['uv'],
        defaultBindings: [],
        preventDefault: true
    },

    // Animation - Node operations
    {
        id: 'animation.deleteSelectedNode',
        label: '删除选中节点',
        category: '动画',
        contexts: ['animation'],
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
        label: '快速K帧（位移/旋转/缩放）',
        category: '时间轴',
        contexts: ['animation'],
        defaultBindings: ['K'],
        preventDefault: true
    },
    {
        id: 'timeline.prevKeyframe',
        label: '上一个关键帧',
        category: '时间轴',
        contexts: ['animation'],
        defaultBindings: ['ArrowLeft'],
        preventDefault: true
    },
    {
        id: 'timeline.nextKeyframe',
        label: '下一个关键帧',
        category: '时间轴',
        contexts: ['animation'],
        defaultBindings: ['ArrowRight'],
        preventDefault: true
    },
    {
        id: 'timeline.goToStart',
        label: '跳到序列起点',
        category: '时间轴',
        contexts: ['animation'],
        defaultBindings: [],
        preventDefault: true
    },
    {
        id: 'timeline.prevFrame',
        label: '上一帧',
        category: '时间轴',
        contexts: ['animation'],
        defaultBindings: [],
        preventDefault: true
    },
    {
        id: 'timeline.nextFrame',
        label: '下一帧',
        category: '时间轴',
        contexts: ['animation'],
        defaultBindings: [],
        preventDefault: true
    },
    {
        id: 'timeline.goToEnd',
        label: '跳到序列终点',
        category: '时间轴',
        contexts: ['animation'],
        defaultBindings: [],
        preventDefault: true
    },
    {
        id: 'timeline.displayNode',
        label: '显示节点关键帧',
        category: '时间轴',
        contexts: ['animation'],
        defaultBindings: [],
        preventDefault: true
    },
    {
        id: 'timeline.displayGeosetAnim',
        label: '显示多边形动画关键帧',
        category: '时间轴',
        contexts: ['animation'],
        defaultBindings: [],
        preventDefault: true
    },
    {
        id: 'timeline.displayParticle',
        label: '显示粒子关键帧',
        category: '时间轴',
        contexts: ['animation'],
        defaultBindings: [],
        preventDefault: true
    },
    {
        id: 'timeline.displayTextureAnim',
        label: '显示贴图动画关键帧',
        category: '时间轴',
        contexts: ['animation'],
        defaultBindings: [],
        preventDefault: true
    },
    {
        id: 'timeline.displayMaterial',
        label: '显示材质关键帧',
        category: '时间轴',
        contexts: ['animation'],
        defaultBindings: [],
        preventDefault: true
    },
    {
        id: 'timeline.toggleAllKeyframes',
        label: '显示/隐藏所有关键帧类型',
        category: '时间轴',
        contexts: ['animation'],
        defaultBindings: [],
        preventDefault: true
    },
    {
        id: 'timeline.toggleAllOwnerKeyframes',
        label: '显示所有/选中对象关键帧',
        category: '时间轴',
        contexts: ['animation'],
        defaultBindings: [],
        preventDefault: true
    },
]

export const shortcutActionMap = new Map(shortcutActions.map((action) => [action.id, action]))
