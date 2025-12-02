import React from 'react';
import { Card, Typography, Empty } from 'antd';
import { useSelectionStore } from '../store/selectionStore';

const { Text } = Typography;

interface BoneWeightPanelProps {
    renderer: any; // Using any for now to avoid complex type imports, should be ModelRenderer
}

export const BoneWeightPanel: React.FC<BoneWeightPanelProps> = ({ renderer }) => {
    const { selectedVertexIds, mainMode, animationSubMode } = useSelectionStore();

    if (mainMode !== 'animation' || animationSubMode !== 'binding') {
        return null;
    }

    // Calculate affecting bones
    // const affectingBones: { name: string; id: number; count: number }[] = [];

    if (renderer && renderer.model && selectedVertexIds.length > 0) {
        // const boneCounts = new Map<number, number>();

        selectedVertexIds.forEach(sel => {
            const geoset = renderer.model.Geosets[sel.geosetIndex];
            if (geoset) {
                const vertexGroupIndex = geoset.VertexGroup[sel.index];
                const matrixGroups = geoset.MatrixGroups;
                // In MDL/MDX, VertexGroup points to a MatrixGroup, which is a list of Bone IDs
                // But often in simple models, VertexGroup maps directly to a Bone or a MatrixGroup of size 1

                // Simplified logic: Find which bones affect this vertex
                // This requires parsing MatrixGroups which maps to Nodes

                // For now, let's just show the MatrixGroup index and try to resolve to Node
                // This part is complex because MDL structure varies.
                // Let's assume standard rigid binding for now.

                // Actually, let's just list the bones that are currently selected if any,
                // OR if we can map vertex -> bone.

                // Let's try to get the Node from the MatrixGroup
                // let matrixGroupSize = 0;
                let startIndex = 0;
                for (let i = 0; i < matrixGroups.length; i++) {
                    if (i === vertexGroupIndex) {
                        // matrixGroupSize = matrixGroups[i];
                        break;
                    }
                    startIndex += matrixGroups[i];
                }

                // The actual bone indices are in geoset.MatrixIndices (if it exists) or we need to look up how war3-model handles it.
                // war3-model typically processes this.

                // Fallback: Just show "Vertex Selected" count for now until we have deep model access
            }
        });
    }

    return (
        <div style={{
            position: 'absolute',
            right: '20px',
            top: '100px',
            width: '250px',
            zIndex: 100,
            pointerEvents: 'auto'
        }}>
            <Card
                title={<span style={{ color: '#fff' }}>Bone Influence</span>}
                size="small"
                style={{
                    backgroundColor: 'rgba(40, 40, 40, 0.9)',
                    border: '1px solid #555'
                }}
                headStyle={{ borderBottom: '1px solid #555' }}
            >
                {selectedVertexIds.length === 0 ? (
                    <Empty description={<span style={{ color: '#aaa' }}>No vertices selected</span>} image={Empty.PRESENTED_IMAGE_SIMPLE} />
                ) : (
                    <div style={{ color: '#fff' }}>
                        <Text style={{ color: '#ccc' }}>Selected Vertices: {selectedVertexIds.length}</Text>
                        <div style={{ marginTop: 8 }}>
                            <Text style={{ color: '#aaa', fontSize: '12px' }}>
                                (Bone weight display to be implemented with deep model data access)
                            </Text>
                        </div>
                    </div>
                )}
            </Card>
        </div>
    );
};
