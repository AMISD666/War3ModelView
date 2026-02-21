import { SmartInputNumber as InputNumber } from '@renderer/components/common/SmartInputNumber'
import React from 'react';
import { Select, Checkbox, Typography } from 'antd';

const { Text } = Typography;

export interface LayerConfig {
    textureId: number;
    filterMode: number;
    alpha: number;
    unshaded: boolean;
    unfogged: boolean;
    twoSided: boolean;
    sphereEnvMap: boolean;
    noDepthTest: boolean;
    noDepthSet: boolean;
}

export const DEFAULT_LAYER_CONFIG: LayerConfig = {
    textureId: 0,
    filterMode: 0,
    alpha: 1,
    unshaded: true,
    unfogged: false,
    twoSided: true,
    sphereEnvMap: false,
    noDepthTest: false,
    noDepthSet: false,
};

interface TextureInfo {
    id: number;
    path: string;
}

interface MaterialLayerOptionsProps {
    value: LayerConfig;
    onChange: (config: LayerConfig) => void;
    textures: TextureInfo[];
}

const filterModeOptions = [
    { value: 0, label: 'None' },
    { value: 1, label: 'Transparent' },
    { value: 2, label: 'Blend' },
    { value: 3, label: 'Additive' },
    { value: 4, label: 'Add Alpha' },
    { value: 5, label: 'Modulate' },
    { value: 6, label: 'Modulate 2X' },
];

export const MaterialLayerOptions: React.FC<MaterialLayerOptionsProps> = ({
    value,
    onChange,
    textures
}) => {
    const handleChange = <K extends keyof LayerConfig>(key: K, val: LayerConfig[K]) => {
        onChange({ ...value, [key]: val });
    };

    const textureOptions = textures.map(t => {
        const filename = t.path.replace(/\\/g, '/').split('/').pop() || t.path;
        return {
            value: t.id,
            label: (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left', marginRight: 8 }} title={t.path}>
                        {filename}
                    </span>
                    <span style={{ fontWeight: 'bold', minWidth: 24, textAlign: 'right', color: '#888', fontSize: '0.9em' }}>#{t.id}</span>
                </div>
            )
        };
    });
    if (textureOptions.length === 0) {
        textureOptions.push({ value: -1, label: <span>No Textures</span> });
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Texture ID */}
            <div>
                <Text style={{ display: 'block', marginBottom: 4, color: '#b0b0b0' }}>贴图 ID:</Text>
                <Select
                    size="small"
                    style={{ width: '100%' }}
                    value={value.textureId}
                    onChange={(v) => handleChange('textureId', v)}
                    options={textureOptions}
                    popupClassName="dark-theme-select-dropdown"
                />
            </div>

            {/* Filter Mode & Alpha */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                    <Text style={{ display: 'block', marginBottom: 4, color: '#b0b0b0' }}>过滤模式:</Text>
                    <Select
                        size="small"
                        style={{ width: '100%' }}
                        value={value.filterMode}
                        onChange={(v) => handleChange('filterMode', v)}
                        options={filterModeOptions}
                        popupClassName="dark-theme-select-dropdown"
                    />
                </div>
                <div>
                    <Text style={{ display: 'block', marginBottom: 4, color: '#b0b0b0' }}>透明度 (Alpha):</Text>
                    <InputNumber
                        size="small"
                        style={{ width: '100%', backgroundColor: '#252525', borderColor: '#4a4a4a', color: '#e8e8e8' }}
                        value={value.alpha}
                        onChange={(v) => handleChange('alpha', v ?? 1)}
                        step={0.01}
                        min={0}
                        max={1}
                        precision={2}
                    />
                </div>
            </div>

            {/* Flags */}
            <div>
                <Text style={{ display: 'block', marginBottom: 8, color: '#b0b0b0' }}>标记 (Flags):</Text>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    <Checkbox checked={value.unshaded} onChange={(e) => handleChange('unshaded', e.target.checked)} style={{ color: '#e8e8e8' }}>无阴影 (Unshaded)</Checkbox>
                    <Checkbox checked={value.unfogged} onChange={(e) => handleChange('unfogged', e.target.checked)} style={{ color: '#e8e8e8' }}>无迷雾 (Unfogged)</Checkbox>
                    <Checkbox checked={value.twoSided} onChange={(e) => handleChange('twoSided', e.target.checked)} style={{ color: '#e8e8e8' }}>双面的 (Two Sided)</Checkbox>
                    <Checkbox checked={value.sphereEnvMap} onChange={(e) => handleChange('sphereEnvMap', e.target.checked)} style={{ color: '#e8e8e8' }}>球面环境贴图</Checkbox>
                    <Checkbox checked={value.noDepthTest} onChange={(e) => handleChange('noDepthTest', e.target.checked)} style={{ color: '#e8e8e8' }}>无深度测试</Checkbox>
                    <Checkbox checked={value.noDepthSet} onChange={(e) => handleChange('noDepthSet', e.target.checked)} style={{ color: '#e8e8e8' }}>无深度设置</Checkbox>
                </div>
            </div>
        </div>
    );
};

/**
 * Convert LayerConfig to a Material Layer object for saving
 */
export function layerConfigToMaterialLayer(config: LayerConfig): any {
    let shading = 0;
    if (config.unshaded) shading |= 1;
    if (config.sphereEnvMap) shading |= 2;
    if (config.twoSided) shading |= 16;
    if (config.unfogged) shading |= 32;
    if (config.noDepthTest) shading |= 64;
    if (config.noDepthSet) shading |= 128;

    return {
        FilterMode: config.filterMode,
        TextureID: config.textureId,
        Alpha: config.alpha,
        Shading: shading,
        CoordId: 0,
        TVertexAnimId: null,
    };
}

export default MaterialLayerOptions;

