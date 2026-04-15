import { SmartInputNumber as InputNumber } from '@renderer/components/common/SmartInputNumber'
import React, { useEffect, useState } from 'react'
import { Checkbox, Col, ConfigProvider, Form, Row, Segmented, theme } from 'antd'
import { mat4, quat, vec3 } from 'gl-matrix'
import { DraggableModal } from '../DraggableModal'
import { useModelStore } from '../../store/modelStore'
import { useUIStore } from '../../store/uiStore'
import { uiText } from '../../constants/uiText'

type TransformCoordinateMode = 'relative' | 'world'

function getModelCenter(modelData: any): [number, number, number] {
    const minimumExtent = modelData?.MinimumExtent ?? modelData?.Info?.MinimumExtent
    const maximumExtent = modelData?.MaximumExtent ?? modelData?.Info?.MaximumExtent

    if (!minimumExtent || !maximumExtent || minimumExtent.length < 3 || maximumExtent.length < 3) {
        return [0, 0, 0]
    }

    return [
        (Number(minimumExtent[0]) + Number(maximumExtent[0])) / 2,
        (Number(minimumExtent[1]) + Number(maximumExtent[1])) / 2,
        (Number(minimumExtent[2]) + Number(maximumExtent[2])) / 2,
    ]
}

function getModelSize(modelData: any): [number, number, number] {
    const minimumExtent = modelData?.MinimumExtent ?? modelData?.Info?.MinimumExtent
    const maximumExtent = modelData?.MaximumExtent ?? modelData?.Info?.MaximumExtent

    if (!minimumExtent || !maximumExtent || minimumExtent.length < 3 || maximumExtent.length < 3) {
        return [0, 0, 0]
    }

    return [
        Number(maximumExtent[0]) - Number(minimumExtent[0]),
        Number(maximumExtent[1]) - Number(minimumExtent[1]),
        Number(maximumExtent[2]) - Number(minimumExtent[2]),
    ]
}

function quatToEulerDegrees(q: quat): [number, number, number] {
    const x = q[0], y = q[1], z = q[2], w = q[3]
    const sinrCosp = 2 * (w * x + y * z)
    const cosrCosp = 1 - 2 * (x * x + y * y)
    const roll = Math.atan2(sinrCosp, cosrCosp)

    const sinp = 2 * (w * y - z * x)
    const pitch = Math.abs(sinp) >= 1 ? Math.sign(sinp) * Math.PI / 2 : Math.asin(sinp)

    const sinyCosp = 2 * (w * z + x * y)
    const cosyCosp = 1 - 2 * (y * y + z * z)
    const yaw = Math.atan2(sinyCosp, cosyCosp)

    return [roll * 180 / Math.PI, pitch * 180 / Math.PI, yaw * 180 / Math.PI]
}

function decomposeMatrix(matrix: mat4): {
    translation: [number, number, number]
    rotation: [number, number, number]
    scale: [number, number, number]
} {
    const translation = vec3.create()
    const scaling = vec3.create()
    const rotationQuat = quat.create()
    mat4.getTranslation(translation, matrix)
    mat4.getScaling(scaling, matrix)
    mat4.getRotation(rotationQuat, matrix)

    return {
        translation: [translation[0], translation[1], translation[2]],
        rotation: quatToEulerDegrees(rotationQuat),
        scale: [scaling[0], scaling[1], scaling[2]],
    }
}

export const TransformModelDialog: React.FC = () => {
    const { showTransformModelDialog, setTransformModelDialogVisible } = useUIStore()
    const { transformModel, modelData, globalTransformTracker } = useModelStore()
    const [form] = Form.useForm()
    const [syncScale, setSyncScale] = useState(true)
    const [coordinateMode, setCoordinateMode] = useState<TransformCoordinateMode>('relative')

    const currentModelCenter = getModelCenter(modelData)
    const currentModelSize = getModelSize(modelData)
    const currentWorldRotation = globalTransformTracker.rotation

    useEffect(() => {
        if (!showTransformModelDialog) return

        form.resetFields()
        form.setFieldsValue({
            tx: 0, ty: 0, tz: 0,
            rx: 0, ry: 0, rz: 0,
            sx: 1, sy: 1, sz: 1,
        })
        setSyncScale(true)
        setCoordinateMode('relative')
    }, [showTransformModelDialog, form])

    useEffect(() => {
        if (!showTransformModelDialog) return

        if (coordinateMode === 'world') {
            form.setFieldsValue({
                tx: currentModelCenter[0],
                ty: currentModelCenter[1],
                tz: currentModelCenter[2],
                rx: currentWorldRotation[0],
                ry: currentWorldRotation[1],
                rz: currentWorldRotation[2],
                sx: currentModelSize[0],
                sy: currentModelSize[1],
                sz: currentModelSize[2],
            })
            return
        }

        form.setFieldsValue({
            tx: 0,
            ty: 0,
            tz: 0,
            rx: 0,
            ry: 0,
            rz: 0,
            sx: 1,
            sy: 1,
            sz: 1,
        })
    }, [coordinateMode, currentModelCenter, currentModelSize, currentWorldRotation, form, showTransformModelDialog])

    const handleOk = () => {
        void form.validateFields().then((values) => {
            let translationOps: [number, number, number] | undefined
            let rotationOps: [number, number, number] | undefined
            let scaleOps: [number, number, number] | undefined

            if (coordinateMode === 'world') {
                const translationDelta: [number, number, number] = [
                    values.tx - currentModelCenter[0],
                    values.ty - currentModelCenter[1],
                    values.tz - currentModelCenter[2],
                ]

                const currentRotationQuat = quat.create()
                quat.fromEuler(currentRotationQuat, currentWorldRotation[0], currentWorldRotation[1], currentWorldRotation[2])
                const targetRotationQuat = quat.create()
                quat.fromEuler(targetRotationQuat, values.rx, values.ry, values.rz)
                const inverseCurrentQuat = quat.invert(quat.create(), currentRotationQuat) || quat.create()
                const deltaRotationQuat = quat.multiply(quat.create(), targetRotationQuat, inverseCurrentQuat)
                const deltaRotationEuler = quatToEulerDegrees(deltaRotationQuat)

                const safeScaleFactor = (target: number, current: number): number => {
                    if (Math.abs(current) < 1e-6) return 1
                    return target / current
                }

                const scaleFactors: [number, number, number] = [
                    safeScaleFactor(values.sx, currentModelSize[0]),
                    safeScaleFactor(values.sy, currentModelSize[1]),
                    safeScaleFactor(values.sz, currentModelSize[2]),
                ]

                const transformMatrix = mat4.create()
                mat4.translate(transformMatrix, transformMatrix, translationDelta)
                mat4.translate(transformMatrix, transformMatrix, currentModelCenter)
                const deltaRotationMatrix = mat4.create()
                const deltaRotationQuatMatrix = quat.create()
                quat.fromEuler(deltaRotationQuatMatrix, deltaRotationEuler[0], deltaRotationEuler[1], deltaRotationEuler[2])
                mat4.fromRotationTranslationScale(deltaRotationMatrix, deltaRotationQuatMatrix, [0, 0, 0], scaleFactors)
                mat4.multiply(transformMatrix, transformMatrix, deltaRotationMatrix)
                mat4.translate(transformMatrix, transformMatrix, [-currentModelCenter[0], -currentModelCenter[1], -currentModelCenter[2]])

                const worldOps = decomposeMatrix(transformMatrix)
                translationOps = worldOps.translation
                rotationOps = worldOps.rotation
                scaleOps = worldOps.scale
            } else {
                translationOps = [values.tx, values.ty, values.tz]
                rotationOps = [values.rx, values.ry, values.rz]
                scaleOps = [values.sx, values.sy, values.sz]
            }

            const hasTranslation = !!translationOps && (translationOps[0] !== 0 || translationOps[1] !== 0 || translationOps[2] !== 0)
            const hasRotation = !!rotationOps && (rotationOps[0] !== 0 || rotationOps[1] !== 0 || rotationOps[2] !== 0)
            const hasScale = !!scaleOps && (scaleOps[0] !== 1 || scaleOps[1] !== 1 || scaleOps[2] !== 1)

            if (hasTranslation || hasRotation || hasScale) {
                transformModel({
                    translation: hasTranslation ? translationOps : undefined,
                    rotation: hasRotation ? rotationOps : undefined,
                    scale: hasScale ? scaleOps : undefined,
                })
            }

            setTransformModelDialogVisible(false)
        })
    }

    const handleCancel = () => {
        setTransformModelDialogVisible(false)
    }

    const handleScaleChange = (axis: 'x' | 'y' | 'z', value: number | string | null) => {
        const numVal = typeof value === 'string' ? parseFloat(value) : value
        if (syncScale && numVal !== null && !Number.isNaN(numVal)) {
            if (coordinateMode === 'world') {
                const axisIndex = axis === 'x' ? 0 : axis === 'y' ? 1 : 2
                const baseSize = currentModelSize[axisIndex]
                if (Math.abs(baseSize) < 1e-6) return
                const factor = numVal / baseSize
                form.setFieldsValue({
                    sx: currentModelSize[0] * factor,
                    sy: currentModelSize[1] * factor,
                    sz: currentModelSize[2] * factor,
                })
                return
            }
            form.setFieldsValue({
                sx: numVal,
                sy: numVal,
                sz: numVal,
            })
        }
    }

    const labelStyle = (color: string) => ({
        color,
        fontWeight: 'bold',
        fontSize: 12,
        width: 14,
        marginRight: 4,
        display: 'inline-block',
        textAlign: 'center' as const,
    })

    return (
        <ConfigProvider
            theme={{
                algorithm: theme.darkAlgorithm,
                token: {
                    colorBgContainer: '#252526',
                    colorBgElevated: '#2d2d2d',
                    colorText: '#cccccc',
                    colorTextSecondary: '#888888',
                    colorBorder: '#3e3e42',
                    colorPrimary: '#007acc',
                    borderRadius: 4,
                },
                components: {
                    Form: {
                        itemMarginBottom: 8,
                    },
                    InputNumber: {
                        colorBgContainer: '#3c3c3c',
                    },
                },
            }}
        >
            <DraggableModal
                title={uiText.transformModelDialog.title}
                open={showTransformModelDialog}
                onOk={handleOk}
                onCancel={handleCancel}
                destroyOnClose
                width={380}
                bodyStyle={{ padding: '20px 24px 10px 24px' }}
            >
                <Form form={form} layout="horizontal" labelCol={{ span: 0 }} wrapperCol={{ span: 24 }}>
                    <div style={{ marginBottom: 16 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: '#569cd6', marginBottom: 8 }}>
                            {uiText.transformModelDialog.mode}
                        </div>
                        <Segmented
                            block
                            value={coordinateMode}
                            onChange={(value) => setCoordinateMode(value as TransformCoordinateMode)}
                            options={[
                                { label: uiText.transformModelDialog.relativeMode, value: 'relative' },
                                { label: uiText.transformModelDialog.worldMode, value: 'world' },
                            ]}
                            style={{ backgroundColor: '#1f1f1f' }}
                        />
                        {coordinateMode === 'world' && (
                            <div style={{ marginTop: 8, color: '#888', fontSize: 12, lineHeight: 1.5 }}>
                                {uiText.transformModelDialog.worldModeHint}
                            </div>
                        )}
                    </div>

                    <div style={{ marginBottom: 16 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: '#569cd6', marginBottom: 12, display: 'flex', alignItems: 'center' }}>
                            <span style={{ marginRight: 8 }}>
                                {coordinateMode === 'world'
                                    ? uiText.transformModelDialog.translationWorld
                                    : uiText.transformModelDialog.translation}
                            </span>
                            <div style={{ flex: 1, height: 1, background: 'linear-gradient(to right, #444, transparent)' }} />
                        </div>
                        <Row gutter={12}>
                            <Col span={8}>
                                <div style={{ display: 'flex', alignItems: 'center' }}>
                                    <span style={labelStyle('#ff4d4f')}>X</span>
                                    <Form.Item name="tx" style={{ flex: 1, marginBottom: 0 }}>
                                        <InputNumber controls={false} precision={2} style={{ width: '100%' }} />
                                    </Form.Item>
                                </div>
                            </Col>
                            <Col span={8}>
                                <div style={{ display: 'flex', alignItems: 'center' }}>
                                    <span style={labelStyle('#52c41a')}>Y</span>
                                    <Form.Item name="ty" style={{ flex: 1, marginBottom: 0 }}>
                                        <InputNumber controls={false} precision={2} style={{ width: '100%' }} />
                                    </Form.Item>
                                </div>
                            </Col>
                            <Col span={8}>
                                <div style={{ display: 'flex', alignItems: 'center' }}>
                                    <span style={labelStyle('#108ee9')}>Z</span>
                                    <Form.Item name="tz" style={{ flex: 1, marginBottom: 0 }}>
                                        <InputNumber controls={false} precision={2} style={{ width: '100%' }} />
                                    </Form.Item>
                                </div>
                            </Col>
                        </Row>
                    </div>

                    <div style={{ marginBottom: 16 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: '#569cd6', marginBottom: 12, display: 'flex', alignItems: 'center' }}>
                            <span style={{ marginRight: 8 }}>
                                {coordinateMode === 'world'
                                    ? uiText.transformModelDialog.rotationWorld
                                    : uiText.transformModelDialog.rotation}
                            </span>
                            <div style={{ flex: 1, height: 1, background: 'linear-gradient(to right, #444, transparent)' }} />
                        </div>
                        <Row gutter={12}>
                            <Col span={8}>
                                <div style={{ display: 'flex', alignItems: 'center' }}>
                                    <span style={labelStyle('#ff4d4f')}>X</span>
                                    <Form.Item name="rx" style={{ flex: 1, marginBottom: 0 }}>
                                        <InputNumber controls={false} precision={2} style={{ width: '100%' }} />
                                    </Form.Item>
                                </div>
                            </Col>
                            <Col span={8}>
                                <div style={{ display: 'flex', alignItems: 'center' }}>
                                    <span style={labelStyle('#52c41a')}>Y</span>
                                    <Form.Item name="ry" style={{ flex: 1, marginBottom: 0 }}>
                                        <InputNumber controls={false} precision={2} style={{ width: '100%' }} />
                                    </Form.Item>
                                </div>
                            </Col>
                            <Col span={8}>
                                <div style={{ display: 'flex', alignItems: 'center' }}>
                                    <span style={labelStyle('#108ee9')}>Z</span>
                                    <Form.Item name="rz" style={{ flex: 1, marginBottom: 0 }}>
                                        <InputNumber controls={false} precision={2} style={{ width: '100%' }} />
                                    </Form.Item>
                                </div>
                            </Col>
                        </Row>
                    </div>

                    <div>
                        <div style={{ fontSize: 13, fontWeight: 500, color: '#569cd6', marginBottom: 12, display: 'flex', alignItems: 'center' }}>
                            <span style={{ marginRight: 8 }}>
                                {coordinateMode === 'world'
                                    ? uiText.transformModelDialog.scaleWorld
                                    : uiText.transformModelDialog.scale}
                            </span>
                            <div style={{ flex: 1, height: 1, background: 'linear-gradient(to right, #444, transparent)' }} />
                        </div>
                        <Row gutter={12}>
                            <Col span={8}>
                                <div style={{ display: 'flex', alignItems: 'center' }}>
                                    <span style={labelStyle('#ff4d4f')}>X</span>
                                    <Form.Item name="sx" style={{ flex: 1, marginBottom: 0 }}>
                                        <InputNumber
                                            controls={false}
                                            precision={2}
                                            style={{ width: '100%' }}
                                            onChange={(val) => handleScaleChange('x', val)}
                                        />
                                    </Form.Item>
                                </div>
                            </Col>
                            <Col span={8}>
                                <div style={{ display: 'flex', alignItems: 'center' }}>
                                    <span style={labelStyle('#52c41a')}>Y</span>
                                    <Form.Item name="sy" style={{ flex: 1, marginBottom: 0 }}>
                                        <InputNumber
                                            controls={false}
                                            precision={2}
                                            style={{ width: '100%' }}
                                            onChange={(val) => handleScaleChange('y', val)}
                                        />
                                    </Form.Item>
                                </div>
                            </Col>
                            <Col span={8}>
                                <div style={{ display: 'flex', alignItems: 'center' }}>
                                    <span style={labelStyle('#108ee9')}>Z</span>
                                    <Form.Item name="sz" style={{ flex: 1, marginBottom: 0 }}>
                                        <InputNumber
                                            controls={false}
                                            precision={2}
                                            style={{ width: '100%' }}
                                            onChange={(val) => handleScaleChange('z', val)}
                                        />
                                    </Form.Item>
                                </div>
                            </Col>
                        </Row>
                        <Form.Item style={{ marginTop: 12, marginBottom: 4 }}>
                            <Checkbox
                                checked={syncScale}
                                onChange={(e) => setSyncScale(e.target.checked)}
                                style={{ fontSize: 12, color: '#aaa' }}
                            >
                                {uiText.transformModelDialog.syncScale}
                            </Checkbox>
                        </Form.Item>
                    </div>
                </Form>
            </DraggableModal>
        </ConfigProvider>
    )
}
