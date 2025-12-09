/**
 * 模型信息面板组件
 */

import React, { useMemo } from 'react';
import { useModelStore } from '../../store/modelStore';
import { NodeType } from '../../types/node';

const lineStyle: React.CSSProperties = {
    lineHeight: '1.6',
    fontSize: '12px',
    color: '#ccc',
    whiteSpace: 'nowrap'
};

export const ModelInfoPanel: React.FC = () => {
    const { modelData, nodes } = useModelStore();

    const stats = useMemo(() => {
        if (!modelData) return null;

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
            globalSequences: modelData.GlobalSequences?.length || 0,
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
    }, [modelData, nodes]);

    if (!modelData || !stats) {
        return <div style={{ padding: '8px', color: '#888', fontSize: '12px' }}>暂无模型数据</div>;
    }

    const modelChunk = modelData.Model || {} as any;

    return (
        <div style={{ padding: '8px 12px', overflowY: 'auto', height: '100%' }}>
            <div style={lineStyle}>名称: {modelChunk.Name || '未知'}</div>
            <div style={lineStyle}>版本: {modelData.Version?.FormatVersion || '未知'}</div>
            <div style={lineStyle}>混合时间: {modelChunk.BlendTime || 0}</div>
            {modelChunk.BoundsRadius !== undefined && (
                <div style={lineStyle}>包围半径: {modelChunk.BoundsRadius.toFixed(2)}</div>
            )}
            <div style={lineStyle}>Geosets: {stats.geosets}</div>
            <div style={lineStyle}>顶点: {stats.vertices}</div>
            <div style={lineStyle}>面: {stats.faces}</div>
            <div style={lineStyle}>纹理: {stats.textures}</div>
            <div style={lineStyle}>材质: {stats.materials}</div>
            <div style={lineStyle}>动画序列: {stats.sequences}</div>
            <div style={lineStyle}>全局序列: {stats.globalSequences}</div>
            <div style={lineStyle}>骨骼: {stats.bones}</div>
            <div style={lineStyle}>辅助点: {stats.helpers}</div>
            <div style={lineStyle}>附加点: {stats.attachments}</div>
            <div style={lineStyle}>光源: {stats.lights}</div>
            <div style={lineStyle}>相机: {stats.cameras}</div>
            <div style={lineStyle}>粒子发射器: {stats.particleEmitters}</div>
            <div style={lineStyle}>粒子发射器2: {stats.particleEmitters2}</div>
            <div style={lineStyle}>带状发射器: {stats.ribbonEmitters}</div>
            <div style={lineStyle}>事件对象: {stats.eventObjects}</div>
            <div style={lineStyle}>碰撞体: {stats.collisionShapes}</div>
        </div>
    );
};
