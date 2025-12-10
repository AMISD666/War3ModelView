/**
 * 模型信息面板组件
 */

import React, { useMemo } from 'react';
import { useModelStore } from '../../store/modelStore';
import { NodeType } from '../../types/node';

const rowStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    lineHeight: '1.6',
    fontSize: '12px',
    color: '#ccc',
    whiteSpace: 'nowrap',
    gap: '20px'  // Increased gap between label and value
};

const labelStyle: React.CSSProperties = {
    textAlign: 'left',
    flexShrink: 0
};

const valueStyle: React.CSSProperties = {
    textAlign: 'right',
    color: '#fff',
    minWidth: '30px'
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

    const InfoRow = ({ label, value }: { label: string; value: string | number }) => (
        <div style={rowStyle}>
            <span style={labelStyle}>{label}</span>
            <span style={valueStyle}>{value}</span>
        </div>
    );

    return (
        <div style={{ padding: '8px 12px', overflowY: 'auto', height: '100%' }}>
            <InfoRow label="混合时间" value={modelChunk.BlendTime || 0} />
            {modelChunk.BoundsRadius !== undefined && (
                <InfoRow label="包围半径" value={modelChunk.BoundsRadius.toFixed(2)} />
            )}
            <InfoRow label="Geosets" value={stats.geosets} />
            <InfoRow label="顶点" value={stats.vertices} />
            <InfoRow label="面" value={stats.faces} />
            <InfoRow label="纹理" value={stats.textures} />
            <InfoRow label="材质" value={stats.materials} />
            <InfoRow label="动画序列" value={stats.sequences} />
            <InfoRow label="全局序列" value={stats.globalSequences} />
            <InfoRow label="骨骼" value={stats.bones} />
            <InfoRow label="辅助点" value={stats.helpers} />
            <InfoRow label="附加点" value={stats.attachments} />
            <InfoRow label="光源" value={stats.lights} />
            <InfoRow label="相机" value={stats.cameras} />
            <InfoRow label="粒子发射器" value={stats.particleEmitters} />
            <InfoRow label="粒子发射器2" value={stats.particleEmitters2} />
            <InfoRow label="带状发射器" value={stats.ribbonEmitters} />
            <InfoRow label="事件对象" value={stats.eventObjects} />
            <InfoRow label="碰撞体" value={stats.collisionShapes} />
        </div>
    );
};
