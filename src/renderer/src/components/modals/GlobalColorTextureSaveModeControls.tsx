import React from 'react'
import { Button, Input } from 'antd'

export type GlobalColorTextureSaveMode = 'overwrite' | 'save_as'

interface GlobalColorTextureSaveModeControlsProps {
    mode: GlobalColorTextureSaveMode
    suffix: string
    onModeChange: (mode: GlobalColorTextureSaveMode) => void
    onSuffixChange: (suffix: string) => void
    sectionHeaderStyle: React.CSSProperties
    sectionTitleStyle: React.CSSProperties
    itemContainerStyle: React.CSSProperties
}

export const GlobalColorTextureSaveModeControls: React.FC<GlobalColorTextureSaveModeControlsProps> = ({
    mode,
    suffix,
    onModeChange,
    onSuffixChange,
    sectionHeaderStyle,
    sectionTitleStyle,
    itemContainerStyle,
}) => {
    const isSaveAsMode = mode === 'save_as'

    return (
        <div>
            <div style={sectionHeaderStyle}>
                <div style={sectionTitleStyle}>贴图保存</div>
            </div>
            <div style={{ ...itemContainerStyle, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Button
                        size="small"
                        type={!isSaveAsMode ? 'primary' : 'default'}
                        onClick={() => onModeChange('overwrite')}
                        style={{ width: 72, flexShrink: 0 }}
                    >
                        覆盖
                    </Button>
                    <Button
                        size="small"
                        type={isSaveAsMode ? 'primary' : 'default'}
                        onClick={() => onModeChange('save_as')}
                        style={{ width: 72, flexShrink: 0 }}
                    >
                        另存为
                    </Button>
                    <div style={{ flex: 1, minWidth: 0, color: '#8c8c8c', fontSize: 11 }}>
                        {isSaveAsMode
                            ? '保存时生成带后缀的新贴图并更新模型引用'
                            : '保存时直接写回当前模型引用的贴图'}
                    </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: isSaveAsMode ? 1 : 0.45 }}>
                    <span style={{ width: 56, color: '#aaa', fontSize: 12, flexShrink: 0 }}>名称后缀</span>
                    <Input
                        size="small"
                        value={suffix}
                        onChange={(event) => onSuffixChange(event.target.value)}
                        placeholder="_1"
                        disabled={!isSaveAsMode}
                        style={{ width: 120, backgroundColor: '#000', borderColor: '#333', color: '#eee' }}
                    />
                </div>
            </div>
        </div>
    )
}

export default GlobalColorTextureSaveModeControls
