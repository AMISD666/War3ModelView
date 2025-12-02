/**
 * 模型信息面板组件
 */

import React, { useMemo } from 'react';
import { Descriptions, Card, Statistic, Row, Col, Divider, Empty } from 'antd';
import { useModelStore } from '../../store/modelStore';
import { NodeType } from '../../types/node';

export const ModelInfoPanel: React.FC = () => {
    const { modelData, nodes } = useModelStore();

    // 计算统计信息
    const stats = useMemo(() => {
        if (!modelData) {
            return null;
        }

        // 节点统计
        const nodeStats = {
            total: nodes.length,
            bones: nodes.filter(n => n.type === NodeType.BONE).length,
            helpers: nodes.filter(n => n.type === NodeType.HELPER).length,
            attachments: nodes.filter(n => n.type === NodeType.ATTACHMENT).length,
            lights: nodes.filter(n => n.type === NodeType.LIGHT).length,
            particleEmitters: nodes.filter(n => n.type === NodeType.PARTICLE_EMITTER).length,
            particleEmitters2: nodes.filter(n => n.type === NodeType.PARTICLE_EMITTER_2).length,
            ribbonEmitters: nodes.filter(n => n.type === NodeType.RIBBON_EMITTER).length,
            eventObjects: nodes.filter(n => n.type === NodeType.EVENT_OBJECT).length,
            collisionShapes: nodes.filter(n => n.type === NodeType.COLLISION_SHAPE).length,
            cameras: nodes.filter(n => n.type === NodeType.CAMERA).length
        };

        // 几何体统计
        const geosets = modelData.Geosets || [];
        let totalVertices = 0;
        let totalFaces = 0;

        geosets.forEach(geoset => {
            totalVertices += geoset.Vertices?.length || 0;
            totalFaces += (geoset.Faces?.length || 0) / 3;
        });

        return {
            geosets: geosets.length,
            vertices: totalVertices,
            faces: Math.floor(totalFaces),
            textures: modelData.Textures?.length || 0,
            materials: modelData.Materials?.length || 0,
            sequences: modelData.Sequences?.length || 0,
            nodes: nodeStats
        };
    }, [modelData, nodes]);

    if (!modelData || !stats || !modelData.Model) {
        return (
            <div style={{ padding: '20px' }}>
                <Empty description="暂无模型数据" />
            </div>
        );
    }

    return (
        <div style={{ padding: '12px', overflowY: 'auto', height: '100%' }}>
            <Card title="模型统计信息" size="small" bordered={false}>
                {/* 几何体统计 */}
                <Row gutter={[16, 16]}>
                    <Col span={8}>
                        <Statistic title="Geosets" value={stats.geosets} />
                    </Col>
                    <Col span={8}>
                        <Statistic title="顶点" value={stats.vertices} />
                    </Col>
                    <Col span={8}>
                        <Statistic title="面" value={stats.faces} />
                    </Col>
                </Row>

                <Divider />

                {/* 资源统计 */}
                <Row gutter={[16, 16]}>
                    <Col span={12}>
                        <Statistic title="纹理" value={stats.textures} />
                    </Col>
                    <Col span={12}>
                        <Statistic title="材质" value={stats.materials} />
                    </Col>
                </Row>

                <Divider />

                {/* 动画统计 */}
                <Row gutter={[16, 16]}>
                    <Col span={24}>
                        <Statistic title="动画序列" value={stats.sequences} />
                    </Col>
                </Row>

                <Divider />

                {/* 节点统计 */}
                <div>
                    <h4 style={{ marginBottom: 12 }}>节点统计</h4>
                    <Descriptions column={2} size="small" bordered>
                        <Descriptions.Item label="总计">{stats.nodes.total}</Descriptions.Item>
                        <Descriptions.Item label="骨骼">{stats.nodes.bones}</Descriptions.Item>
                        <Descriptions.Item label="辅助点">{stats.nodes.helpers}</Descriptions.Item>
                        <Descriptions.Item label="附加点">{stats.nodes.attachments}</Descriptions.Item>
                        <Descriptions.Item label="光源">{stats.nodes.lights}</Descriptions.Item>
                        <Descriptions.Item label="相机">{stats.nodes.cameras}</Descriptions.Item>
                        <Descriptions.Item label="粒子发射器">{stats.nodes.particleEmitters}</Descriptions.Item>
                        <Descriptions.Item label="粒子发射器2">{stats.nodes.particleEmitters2}</Descriptions.Item>
                        <Descriptions.Item label="带状发射器">{stats.nodes.ribbonEmitters}</Descriptions.Item>
                        <Descriptions.Item label="事件对象">{stats.nodes.eventObjects}</Descriptions.Item>
                        <Descriptions.Item label="碰撞体" span={2}>{stats.nodes.collisionShapes}</Descriptions.Item>
                    </Descriptions>
                </div>
            </Card>

            <Card title="模型属性" size="small" bordered={false} style={{ marginTop: 12 }}>
                <Descriptions column={1} size="small" bordered>
                    <Descriptions.Item label="名称">{modelData.Model?.Name || '未知'}</Descriptions.Item>
                    <Descriptions.Item label="版本">{modelData.Version?.FormatVersion || '未知'}</Descriptions.Item>
                    <Descriptions.Item label="混合时间">{modelData.Model?.BlendTime || 0}</Descriptions.Item>
                    {modelData.Model?.BoundsRadius !== undefined && (
                        <Descriptions.Item label="包围半径">
                            {modelData.Model.BoundsRadius.toFixed(2)}
                        </Descriptions.Item>
                    )}
                </Descriptions>
            </Card>
        </div>
    );
};
