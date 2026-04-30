import type { ShortcutAction } from './actions'

export const retargetShortcutActions: ShortcutAction[] = [
    {
        id: 'retarget.copyNodeData',
        label: '套动作复制节点数据',
        category: '套动作',
        contexts: ['retarget'],
        defaultBindings: [],
        preventDefault: true
    },
    {
        id: 'retarget.replaceSequences',
        label: '套动作替换动作序列',
        category: '套动作',
        contexts: ['retarget'],
        defaultBindings: [],
        preventDefault: true
    },
    {
        id: 'retarget.replaceSingleSequence',
        label: '套动作单动作替换',
        category: '套动作',
        contexts: ['retarget'],
        defaultBindings: [],
        preventDefault: true
    },
    {
        id: 'retarget.playPauseSource',
        label: '套动作 A 区播放/暂停',
        category: '套动作',
        contexts: ['retarget'],
        defaultBindings: [],
        preventDefault: true
    },
    {
        id: 'retarget.playPauseTarget',
        label: '套动作 B 区播放/暂停',
        category: '套动作',
        defaultBindings: [],
        contexts: ['retarget'],
        preventDefault: true
    },
]
