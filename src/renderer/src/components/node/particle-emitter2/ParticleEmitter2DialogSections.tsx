import React from 'react';
import { Button, Checkbox, Form, Select, Slider } from 'antd';
import { UndoOutlined } from '@ant-design/icons';
import type { Color } from 'antd/es/color-picker';
import type { ParticleEmitter2Node } from '../../../types/node';
import { uiText } from '../../../constants/uiText';
import { PARTICLE_EMITTER2_FILTER_MODE_OPTIONS } from '../../../constants/filterModes';
import { getDraggedTextureIndex } from '../../../utils/textureDragDrop';
import { InputNumber } from './DeferredInputNumber';
import { ParticleEmitter2ColorFieldControl } from './ParticleEmitter2ColorFieldControl';
import type { SegmentColorTuple } from './types';

interface BoxedNumericFieldProps {
    label: string;
    name: string;
    min?: number;
    max?: number;
    precision?: number;
    width?: number | string;
    isDynamic: boolean;
    onDynamicChange: (propName: string, checked: boolean) => void;
    onOpenKeyframeEditor: (propName: string, title: string) => void;
}

export const BoxedNumericField: React.FC<BoxedNumericFieldProps> = ({
    label,
    name,
    min,
    max,
    precision,
    width,
    isDynamic,
    onDynamicChange,
    onOpenKeyframeEditor,
}) => (
    <div style={{
        border: '1px solid #484848',
        padding: '12px 6px 6px 6px',
        position: 'relative',
        marginTop: 8,
        backgroundColor: '#2b2b2b',
        borderRadius: 2,
        width,
    }}>
        <span style={{
            position: 'absolute',
            top: -9,
            left: 8,
            backgroundColor: '#1f1f1f',
            padding: '0 4px',
            fontSize: 12,
            color: '#ccc',
        }}>
            {label}
        </span>

        <div style={{ marginBottom: 6 }}>
            <Checkbox
                checked={isDynamic}
                onChange={(e) => onDynamicChange(name, e.target.checked)}
                style={{ color: '#ccc', fontSize: 12 }}
            >
                动态化
            </Checkbox>
        </div>

        <Button
            block
            size="small"
            onClick={() => onOpenKeyframeEditor(name, label)}
            disabled={!isDynamic}
            style={{
                marginBottom: 6,
                backgroundColor: '#444',
                color: isDynamic ? '#fff' : '#888',
                borderColor: '#555',
                height: 28,
            }}
        >
            {label}
        </Button>

        <Form.Item name={name} noStyle>
            <InputNumber
                style={{ width: '100%', backgroundColor: '#333', borderColor: '#444', color: '#fff' }}
                min={min}
                max={max}
                precision={precision}
                disabled={isDynamic}
                size="small"
                placeholder="0"
            />
        </Form.Item>
    </div>
);

interface RenderingSectionProps {
    textureOptions: Array<{ label: string; value: number }>;
    isTextureDropActive: boolean;
    setIsTextureDropActive: (value: boolean) => void;
    applyRealtimeTexture: (textureId: number) => void;
}

export const RenderingSection: React.FC<RenderingSectionProps> = ({
    textureOptions,
    isTextureDropActive,
    setIsTextureDropActive,
    applyRealtimeTexture,
}) => (
    <div style={{
        border: '1px solid #484848',
        padding: '12px 8px',
        position: 'relative',
        marginTop: 8,
        backgroundColor: '#2b2b2b',
        borderRadius: 2,
        height: 'calc(100% - 8px)',
    }}>
        <span style={{
            position: 'absolute',
            top: -9,
            left: 8,
            backgroundColor: '#1f1f1f',
            padding: '0 4px',
            fontSize: 12,
            color: '#ccc',
        }}>
            {uiText.particleEmitter2Dialog.rendering}
        </span>

        <div style={{ marginBottom: 12 }}>
            <div style={{ marginBottom: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ color: '#ccc' }}>{uiText.particleEmitter2Dialog.textureId}:</span>
                <span style={{ color: '#7f7f7f', fontSize: 12 }}>{uiText.particleEmitter2Dialog.replaceTextureHint}</span>
            </div>
            <div
                style={{
                    border: isTextureDropActive ? '1px dashed #5a9cff' : '1px dashed transparent',
                    borderRadius: 4,
                    padding: 2,
                    transition: 'border-color 0.15s ease',
                }}
                onDragOver={(e) => {
                    const draggedIndex = getDraggedTextureIndex(e.dataTransfer);
                    if (draggedIndex === null) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'copy';
                    setIsTextureDropActive(true);
                }}
                onDragEnter={(e) => {
                    const draggedIndex = getDraggedTextureIndex(e.dataTransfer);
                    if (draggedIndex === null) return;
                    e.preventDefault();
                    setIsTextureDropActive(true);
                }}
                onDragLeave={() => setIsTextureDropActive(false)}
                onDrop={(e) => {
                    setIsTextureDropActive(false);
                    const draggedIndex = getDraggedTextureIndex(e.dataTransfer);
                    if (draggedIndex === null) return;
                    e.preventDefault();
                    applyRealtimeTexture(draggedIndex);
                }}
            >
                <Form.Item name="TextureID" noStyle>
                    <Select
                        options={textureOptions}
                        style={{ width: '100%' }}
                        size="small"
                        popupMatchSelectWidth={false}
                        onChange={(v) => applyRealtimeTexture(Number(v))}
                    />
                </Form.Item>
            </div>
        </div>

        <div>
            <div style={{ marginBottom: 4, color: '#ccc' }}>过滤模式</div>
            <Form.Item name="FilterMode" noStyle>
                <Select
                    options={PARTICLE_EMITTER2_FILTER_MODE_OPTIONS as any}
                    style={{ width: '100%' }}
                    size="small"
                />
            </Form.Item>
        </div>
    </div>
);

interface ColorFieldProps {
    name: string;
    form: any;
    getCurrentSegmentColors: () => SegmentColorTuple;
    flushPreviewNowWithOverrides: (overrides?: Partial<ParticleEmitter2Node>) => void;
    resetOverallHueState: () => void;
    fromAntdColor: (color: Color | string) => [number, number, number];
}

export const ColorField: React.FC<ColorFieldProps> = ({
    name,
    form,
    getCurrentSegmentColors,
    flushPreviewNowWithOverrides,
    resetOverallHueState,
    fromAntdColor,
}) => (
    <Form.Item shouldUpdate={(prevValues, nextValues) => prevValues?.[name] !== nextValues?.[name]} noStyle>
        {() => {
            const rawValue = form.getFieldValue(name);
            const committedValue = typeof rawValue === 'string'
                ? rawValue
                : rawValue && typeof rawValue.toRgbString === 'function'
                    ? rawValue.toRgbString()
                    : 'rgb(255, 255, 255)';
            return (
                <ParticleEmitter2ColorFieldControl
                    name={name}
                    committedValue={committedValue}
                    form={form}
                    getCurrentSegmentColors={getCurrentSegmentColors}
                    flushPreviewNowWithOverrides={flushPreviewNowWithOverrides}
                    resetOverallHueState={resetOverallHueState}
                    fromAntdColor={fromAntdColor}
                />
            );
        }}
    </Form.Item>
);

interface SegmentBoxProps extends Omit<ColorFieldProps, 'name'> {
    title: string;
    prefix: string;
}

export const SegmentBox: React.FC<SegmentBoxProps> = ({
    title,
    prefix,
    form,
    getCurrentSegmentColors,
    flushPreviewNowWithOverrides,
    resetOverallHueState,
    fromAntdColor,
}) => (
    <fieldset style={{ border: '1px solid #484848', padding: '10px 8px 6px', margin: 0, marginTop: 8, backgroundColor: '#2b2b2b' }}>
        <legend style={{ fontSize: 12, color: '#ccc', marginLeft: 8, padding: '0 4px', width: 'auto' }}>{title}</legend>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ width: 40, color: '#ccc', fontSize: 12 }}>{uiText.particleEmitter2Dialog.color}:</span>
            <ColorField
                name={`${prefix}Color`}
                form={form}
                getCurrentSegmentColors={getCurrentSegmentColors}
                flushPreviewNowWithOverrides={flushPreviewNowWithOverrides}
                resetOverallHueState={resetOverallHueState}
                fromAntdColor={fromAntdColor}
            />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ width: 40, color: '#ccc', fontSize: 12 }}>{uiText.particleEmitter2Dialog.alpha}:</span>
            <Form.Item name={`${prefix}Alpha`} noStyle>
                <InputNumber min={0} max={255} size="small" style={{ flex: 1 }} />
            </Form.Item>
        </div>
        <div style={{ display: 'flex', alignItems: 'center' }}>
            <span style={{ width: 40, color: '#ccc', fontSize: 12 }}>{uiText.particleEmitter2Dialog.scaling}:</span>
            <Form.Item name={`${prefix}Scaling`} noStyle>
                <InputNumber step={1} precision={0} size="small" style={{ flex: 1 }} />
            </Form.Item>
        </div>
    </fieldset>
);

interface OverallAdjustmentsProps {
    overallHueShift: number;
    overallAlphaScale: number;
    overallScaleScale: number;
    applyOverallHueShift: (nextShift: number, flushNow: boolean) => void;
    applyOverallAlphaScale: (nextScale: number, flushNow: boolean) => void;
    applyOverallScaleScale: (nextScale: number, flushNow: boolean) => void;
    resetOverallHueShift: () => void;
    resetOverallAlphaScale: () => void;
    resetOverallScaleScale: () => void;
}

export const OverallAdjustments: React.FC<OverallAdjustmentsProps> = ({
    overallHueShift,
    overallAlphaScale,
    overallScaleScale,
    applyOverallHueShift,
    applyOverallAlphaScale,
    applyOverallScaleScale,
    resetOverallHueShift,
    resetOverallAlphaScale,
    resetOverallScaleScale,
}) => (
    <div style={{ border: '1px solid #484848', padding: '10px 8px', marginTop: 8, backgroundColor: '#2b2b2b' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <span style={{ color: '#ccc', fontSize: 12, whiteSpace: 'nowrap' }}>整体色相</span>
                <Slider
                    min={-180}
                    max={180}
                    step={1}
                    value={overallHueShift}
                    onChange={(value) => applyOverallHueShift(value, false)}
                    onChangeComplete={(value) => applyOverallHueShift(value, true)}
                    tooltip={{ formatter: (value) => `${value ?? 0}°` }}
                    style={{ width: 150, margin: 0 }}
                    styles={{
                        rail: { background: 'linear-gradient(90deg, #ff4d4f, #faad14, #95de64, #5cdbd3, #597ef7, #b37feb, #ff4d4f)' },
                        track: { background: 'transparent' },
                    }}
                />
                <Button size="small" icon={<UndoOutlined />} onClick={resetOverallHueShift} title="重置整体色相" aria-label="重置整体色相" />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <span style={{ color: '#ccc', fontSize: 12, whiteSpace: 'nowrap' }}>整体透明</span>
                <Slider
                    min={0}
                    max={2}
                    step={0.01}
                    value={overallAlphaScale}
                    onChange={(value) => applyOverallAlphaScale(value, false)}
                    onChangeComplete={(value) => applyOverallAlphaScale(value, true)}
                    tooltip={{ formatter: (value) => `${Math.round((value ?? 1) * 100)}%` }}
                    style={{ width: 140, margin: 0 }}
                    styles={{
                        rail: { background: 'linear-gradient(90deg, #4b4b4b, #e8e8e8)' },
                    }}
                />
                <Button size="small" icon={<UndoOutlined />} onClick={resetOverallAlphaScale} title="重置整体透明" aria-label="重置整体透明" />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <span style={{ color: '#ccc', fontSize: 12, whiteSpace: 'nowrap' }}>整体缩放</span>
                <Slider
                    min={0}
                    max={10}
                    step={0.01}
                    value={overallScaleScale}
                    onChange={(value) => applyOverallScaleScale(value, false)}
                    onChangeComplete={(value) => applyOverallScaleScale(value, true)}
                    tooltip={{ formatter: (value) => `${(value ?? 1).toFixed(2)}x` }}
                    style={{ width: 140, margin: 0 }}
                    styles={{
                        rail: { background: 'linear-gradient(90deg, #5b8c00, #d3f261)' },
                    }}
                />
                <Button size="small" icon={<UndoOutlined />} onClick={resetOverallScaleScale} title="重置整体缩放" aria-label="重置整体缩放" />
            </div>
        </div>
    </div>
);

interface LifecycleColumnProps {
    title: string;
    startName: string;
    endName: string;
    repeatName: string;
}

const LifecycleColumn: React.FC<LifecycleColumnProps> = ({ title, startName, endName, repeatName }) => (
    <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 'bold', fontSize: 12, marginBottom: 4 }}>{title}</div>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 2 }}>
            <span style={{ width: 30, fontSize: 12 }}>{uiText.particleEmitter2Dialog.start}:</span>
            <Form.Item name={startName} noStyle><InputNumber size="small" style={{ flex: 1 }} /></Form.Item>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 2 }}>
            <span style={{ width: 30, fontSize: 12 }}>{uiText.particleEmitter2Dialog.end}:</span>
            <Form.Item name={endName} noStyle><InputNumber size="small" style={{ flex: 1 }} /></Form.Item>
        </div>
        <div style={{ display: 'flex', alignItems: 'center' }}>
            <span style={{ width: 30, fontSize: 12 }}>{uiText.particleEmitter2Dialog.repeat}:</span>
            <Form.Item name={repeatName} noStyle><InputNumber size="small" style={{ flex: 1 }} /></Form.Item>
        </div>
    </div>
);

export const LifecycleSection: React.FC = () => (
    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <LifecycleColumn title={uiText.particleEmitter2Dialog.headerLifespan} startName="HeadLifeSpanStart" endName="HeadLifeSpanEnd" repeatName="HeadLifeSpanRepeat" />
        <LifecycleColumn title={uiText.particleEmitter2Dialog.headerDecay} startName="HeadDecayStart" endName="HeadDecayEnd" repeatName="HeadDecayRepeat" />
        <LifecycleColumn title={uiText.particleEmitter2Dialog.tailLifespan} startName="TailLifeSpanStart" endName="TailLifeSpanEnd" repeatName="TailLifeSpanRepeat" />
        <LifecycleColumn title={uiText.particleEmitter2Dialog.tailDecay} startName="TailDecayStart" endName="TailDecayEnd" repeatName="TailDecayRepeat" />
    </div>
);

interface InlineNumericFieldProps {
    label: string;
    name: string;
    labelWidth: number;
    precision?: number;
    step?: number;
}

const InlineNumericField: React.FC<InlineNumericFieldProps> = ({ label, name, labelWidth, precision, step }) => (
    <div style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
        <span style={{ marginRight: 4, fontSize: 12, width: labelWidth }}>{label}:</span>
        <Form.Item name={name} noStyle><InputNumber size="small" style={{ flex: 1 }} precision={precision} step={step} /></Form.Item>
    </div>
);

export const OtherParamsSection: React.FC = () => (
    <div style={{ border: '1px solid #484848', padding: '8px 12px', marginTop: 12, backgroundColor: '#2b2b2b' }}>
        <div style={{ position: 'relative', top: -16, backgroundColor: '#1f1f1f', padding: '0 4px', width: 'fit-content', color: '#ccc', fontSize: 12 }}>{uiText.particleEmitter2Dialog.other}</div>
        <div style={{ marginTop: -8 }}>
            <div style={{ display: 'flex', gap: 16, marginBottom: 8 }}>
                <InlineNumericField label={uiText.particleEmitter2Dialog.rows} name="Rows" labelWidth={30} />
                <InlineNumericField label={uiText.particleEmitter2Dialog.lifeSpan} name="LifeSpan" labelWidth={60} precision={2} step={0.01} />
                <InlineNumericField label={uiText.particleEmitter2Dialog.priorityPlane} name="PriorityPlane" labelWidth={60} />
                <InlineNumericField label={uiText.particleEmitter2Dialog.time} name="Time" labelWidth={30} precision={1} />
            </div>
            <div style={{ display: 'flex', gap: 16 }}>
                <InlineNumericField label={uiText.particleEmitter2Dialog.columns} name="Columns" labelWidth={30} />
                <InlineNumericField label={uiText.particleEmitter2Dialog.tailLength} name="TailLength" labelWidth={60} precision={1} />
                <InlineNumericField label={uiText.particleEmitter2Dialog.replaceableId} name="ReplaceableId" labelWidth={60} />
                <div style={{ flex: 1 }} />
            </div>
        </div>
    </div>
);

interface FlagsPanelProps {
    onOpenPresetModal: () => void;
}

export const FlagsPanel: React.FC<FlagsPanelProps> = ({ onOpenPresetModal }) => (
    <div style={{ width: 140, display: 'flex', flexDirection: 'column' }}>
        <div style={{ border: '1px solid #484848', padding: '6px 8px', flex: 1, backgroundColor: '#2b2b2b', marginTop: 8, position: 'relative' }}>
            <div style={{ fontWeight: 'bold', marginBottom: 4, paddingBottom: 4, borderBottom: '1px solid #444', color: '#ccc', fontSize: 12 }}>{uiText.particleEmitter2Dialog.flags}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Form.Item name="Unshaded" valuePropName="checked" noStyle><Checkbox style={{ fontSize: 11, color: '#ccc' }}>{uiText.particleEmitter2Dialog.unshaded}</Checkbox></Form.Item>
                <Form.Item name="Unfogged" valuePropName="checked" noStyle><Checkbox style={{ fontSize: 11, color: '#ccc' }}>{uiText.particleEmitter2Dialog.unfogged}</Checkbox></Form.Item>
                <Form.Item name="LineEmitter" valuePropName="checked" noStyle><Checkbox style={{ fontSize: 11, color: '#ccc' }}>{uiText.particleEmitter2Dialog.lineEmitter}</Checkbox></Form.Item>
                <Form.Item name="SortPrimsFarZ" valuePropName="checked" noStyle><Checkbox style={{ fontSize: 11, color: '#ccc' }}>{uiText.particleEmitter2Dialog.sortPrimsFarZ}</Checkbox></Form.Item>
                <Form.Item name="ModelSpace" valuePropName="checked" noStyle><Checkbox style={{ fontSize: 11, color: '#ccc' }}>{uiText.particleEmitter2Dialog.modelSpace}</Checkbox></Form.Item>
                <Form.Item name="XYQuad" valuePropName="checked" noStyle><Checkbox style={{ fontSize: 11, color: '#ccc' }}>{uiText.particleEmitter2Dialog.xyQuad}</Checkbox></Form.Item>
                <Form.Item name="Squirt" valuePropName="checked" noStyle><Checkbox style={{ fontSize: 11, color: '#ccc' }}>{uiText.particleEmitter2Dialog.squirt}</Checkbox></Form.Item>
                <Form.Item name="Head" valuePropName="checked" noStyle><Checkbox style={{ fontSize: 11, color: '#ccc' }}>{uiText.particleEmitter2Dialog.head}</Checkbox></Form.Item>
                <Form.Item name="Tail" valuePropName="checked" noStyle><Checkbox style={{ fontSize: 11, color: '#ccc' }}>{uiText.particleEmitter2Dialog.tail}</Checkbox></Form.Item>
            </div>

            <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <Button onClick={onOpenPresetModal} size="small" block>{uiText.particleEmitter2Dialog.savePreset}</Button>
            </div>
        </div>
    </div>
);
