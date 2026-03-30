import { parseMDX, parseMDL } from 'war3-model';

export interface BoneMatchResult {
    model1BoneCount: number;
    model2BoneCount: number;
    matchedCount: number;
    mergeRate: number; // 0-100
    matchedNames: string[];
    unmatchedNames: string[];
}

export const collectBoneNames = (model: any): string[] => {
    const names: string[] = [];
    const nodeTypes = ['Bones', 'Helpers'];
    nodeTypes.forEach(type => {
        if (Array.isArray(model[type])) {
            model[type].forEach((n: any) => {
                if (n.Name) names.push(n.Name);
            });
        }
    });
    return names;
};

export const collectAllNodes = (model: any): Map<string, any> => {
    const map = new Map<string, any>();
    const nodeTypes = [
        'Bones', 'Helpers', 'Lights', 'Attachments',
        'ParticleEmitters', 'ParticleEmitters2', 'RibbonEmitters',
        'EventObjects', 'CollisionShapes'
    ];
    nodeTypes.forEach(type => {
        if (Array.isArray(model[type])) {
            model[type].forEach((n: any) => {
                if (n.Name) map.set(n.Name, n);
            });
        }
    });
    return map;
};

export const parseModelBuffer = (buffer: ArrayBuffer, filePath: string): any => {
    const ext = filePath.toLowerCase().split('.').pop();
    if (ext === 'mdl') {
        const text = new TextDecoder().decode(buffer);
        return parseMDL(text);
    }
    return parseMDX(buffer);
};

export const computeBoneMatch = (model1: any, model2: any): BoneMatchResult => {
    const names1 = collectBoneNames(model1);
    const names2 = collectBoneNames(model2);
    const set1 = new Set(names1);
    const matchedNames = names2.filter(n => set1.has(n));
    const unmatchedNames = names2.filter(n => !set1.has(n));
    const mergeRate = names1.length > 0 ? Math.round((matchedNames.length / names1.length) * 100) : 0;
    return {
        model1BoneCount: names1.length,
        model2BoneCount: names2.length,
        matchedCount: matchedNames.length,
        mergeRate,
        matchedNames,
        unmatchedNames,
    };
};

export const deepClone = (obj: any): any => {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj !== 'object') return obj;

    if (obj instanceof Float32Array) return new Float32Array(obj);
    if (obj instanceof Uint32Array) return new Uint32Array(obj);
    if (obj instanceof Uint16Array) return new Uint16Array(obj);
    if (obj instanceof Uint8Array) return new Uint8Array(obj);
    if (obj instanceof Int32Array) return new Int32Array(obj);
    if (obj instanceof Int16Array) return new Int16Array(obj);
    if (obj instanceof Int8Array) return new Int8Array(obj);
    if (obj instanceof Float64Array) return new Float64Array(obj);
    if (obj instanceof ArrayBuffer) return obj.slice(0);

    if (Array.isArray(obj)) {
        return obj.map((item: any) => deepClone(item));
    }

    const result: any = {};
    for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            result[key] = deepClone(obj[key]);
        }
    }
    return result;
};

const buildIdToNameMap = (model: any): Map<number, string> => {
    const map = new Map<number, string>();
    const nodeTypes = [
        'Bones', 'Helpers', 'Lights', 'Attachments',
        'ParticleEmitters', 'ParticleEmitters2', 'RibbonEmitters',
        'EventObjects', 'CollisionShapes'
    ];
    nodeTypes.forEach(type => {
        if (Array.isArray(model[type])) {
            model[type].forEach((n: any) => {
                if (typeof n.ObjectId === 'number' && n.Name) {
                    map.set(n.ObjectId, n.Name);
                }
            });
        }
    });
    return map;
};

const buildNameToIdMap = (model: any): Map<string, number> => {
    const map = new Map<string, number>();
    const nodeTypes = [
        'Bones', 'Helpers', 'Lights', 'Attachments',
        'ParticleEmitters', 'ParticleEmitters2', 'RibbonEmitters',
        'EventObjects', 'CollisionShapes'
    ];
    nodeTypes.forEach(type => {
        if (Array.isArray(model[type])) {
            model[type].forEach((n: any) => {
                if (typeof n.ObjectId === 'number' && n.Name && !map.has(n.Name)) {
                    map.set(n.Name, n.ObjectId);
                }
            });
        }
    });
    return map;
};

const rotateVerticesZ90 = (vertices: any): any => {
    if (!vertices) return vertices;
    if (vertices instanceof Float32Array) {
        const result = new Float32Array(vertices.length);
        for (let i = 0; i < vertices.length; i += 3) {
            const x = vertices[i];
            const y = vertices[i + 1];
            const z = vertices[i + 2];
            result[i] = y;       
            result[i + 1] = -x;  
            result[i + 2] = z;   
        }
        return result;
    }
    if (Array.isArray(vertices)) {
        return vertices.map((v: any) => {
            if (Array.isArray(v) && v.length >= 3) {
                return [v[1], -v[0], v[2]];
            }
            return v;
        });
    }
    return vertices;
};

export const mergeGeosets = (base: any, source: any): any => {
    const result = deepClone(base);

    let maxObjectId = -1;
    const nodeTypes = [
        'Bones', 'Helpers', 'Lights', 'Attachments',
        'ParticleEmitters', 'ParticleEmitters2', 'RibbonEmitters',
        'EventObjects', 'CollisionShapes'
    ];
    nodeTypes.forEach(type => {
        if (Array.isArray(result[type])) {
            result[type].forEach((n: any) => {
                if (typeof n.ObjectId === 'number' && n.ObjectId > maxObjectId) {
                    maxObjectId = n.ObjectId;
                }
            });
        }
    });
    const newBoneId = maxObjectId + 1;

    const mergedBone = {
        Name: 'MergedRoot',
        ObjectId: newBoneId,
        Parent: -1,
        Flags: 0,
        GeosetId: -1,
        GeosetAnimId: -1,
    };

    if (!result.Bones) result.Bones = [];
    result.Bones.push(mergedBone);

    if (!result.PivotPoints) result.PivotPoints = [];
    while (result.PivotPoints.length < newBoneId) {
        result.PivotPoints.push(result.PivotPoints[0] || new Float32Array([0, 0, 0]));
    }
    result.PivotPoints.push(new Float32Array([0, 0, 0]));

    if (result.Nodes) {
        result.Nodes.push(mergedBone);
    }

    const texOffset = result.Textures?.length || 0;
    const matOffset = result.Materials?.length || 0;
    const geosetOffset = result.Geosets?.length || 0;

    if (source.Textures && Array.isArray(source.Textures)) {
        if (!result.Textures) result.Textures = [];
        source.Textures.forEach((tex: any) => {
            result.Textures.push(deepClone(tex));
        });
    }

    if (source.Materials && Array.isArray(source.Materials)) {
        if (!result.Materials) result.Materials = [];
        source.Materials.forEach((mat: any) => {
            const clonedMat = deepClone(mat);
            if (clonedMat.Layers && Array.isArray(clonedMat.Layers)) {
                clonedMat.Layers.forEach((layer: any) => {
                    if (typeof layer.TextureID === 'number') {
                        layer.TextureID += texOffset;
                    }
                });
            }
            result.Materials.push(clonedMat);
        });
    }

    if (source.Geosets && Array.isArray(source.Geosets)) {
        if (!result.Geosets) result.Geosets = [];
        source.Geosets.forEach((geoset: any) => {
            const cloned = deepClone(geoset);
            if (typeof cloned.MaterialID === 'number') {
                cloned.MaterialID += matOffset;
            }

            if (cloned.Vertices) {
                cloned.Vertices = rotateVerticesZ90(cloned.Vertices);
            }
            if (cloned.Normals) {
                cloned.Normals = rotateVerticesZ90(cloned.Normals);
            }

            if (Array.isArray(cloned.Groups)) {
                cloned.Groups = cloned.Groups.map(() => [newBoneId]);
            }

            result.Geosets.push(cloned);
        });
    }

    if (source.GeosetAnims && Array.isArray(source.GeosetAnims)) {
        if (!result.GeosetAnims) result.GeosetAnims = [];
        source.GeosetAnims.forEach((anim: any) => {
            const cloned = deepClone(anim);
            if (typeof cloned.GeosetId === 'number') {
                cloned.GeosetId += geosetOffset;
            }
            result.GeosetAnims.push(cloned);
        });
    }

    return result;
};

const ANIM_PROPS = ['Translation', 'Rotation', 'Scaling'];

export const mergeAnimations = (base: any, source: any): any => {
    const result = deepClone(base);
    const nodeTypes = [
        'Bones', 'Helpers', 'Lights', 'Attachments',
        'ParticleEmitters', 'ParticleEmitters2', 'RibbonEmitters',
        'EventObjects', 'CollisionShapes'
    ];

    const sourceNodes = collectAllNodes(source);

    nodeTypes.forEach(type => {
        if (!Array.isArray(result[type])) return;
        result[type].forEach((node: any) => {
            const srcNode = sourceNodes.get(node.Name);
            if (!srcNode) return;
            ANIM_PROPS.forEach(prop => {
                if (srcNode[prop] !== undefined) {
                    node[prop] = deepClone(srcNode[prop]);
                }
            });
            if (srcNode.Visibility !== undefined) {
                node.Visibility = deepClone(srcNode.Visibility);
            }
            if (srcNode.VisibilityAnim !== undefined) {
                node.VisibilityAnim = deepClone(srcNode.VisibilityAnim);
            }
        });
    });

    if (source.Sequences && Array.isArray(source.Sequences)) {
        result.Sequences = deepClone(source.Sequences);
    }

    return result;
};
