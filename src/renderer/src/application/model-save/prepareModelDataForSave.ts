import { repairClassicModelData } from '../../utils/modelUtils'

import {
    buildFallbackNormals,
    ensureAnimVector,
    fixAnimVector,
    fixNode,
    isAnimVector,
    normalizeTextureIdAnimVector,
    toDynamicFloat32Array,
    toFloat32Array,
    toTypedVector,
    toUint16Array,
    toUint8Array,
} from './saveDataCoercion'
import {
    normalizeGlobalSequences,
    normalizeModelInfo,
    normalizeSequences,
    normalizeTextures,
} from './saveDataSections'

/**
 * Normalize model data before saving to ensure typed arrays are correct.
 * The war3-model library expects Uint32Array for Intervals and Float32Array for extents,
 * but JSON.stringify/parse (used for cloning in editors) converts these to regular arrays.
 *
 * Uses structuredClone to preserve existing typed arrays while only converting
 * regular arrays that need to be typed arrays.
 */
export function prepareModelDataForSave(modelData: any): any {
    if (!modelData) return modelData;

    // Use structuredClone to preserve typed arrays (available in modern browsers)
    // Falls back to the original data if structuredClone isn't available
    let data: any;
    const typeMap: Record<number, number> = { 0: 0, 1: 1, 2: 2 };
    try {
        data = structuredClone(modelData);
    } catch {
        // Fallback: work with original data (will mutate it)
        // // console.warn('[MainLayout] structuredClone not available, modifying original data');
        data = modelData;
    }

    normalizeSequences(data);
    normalizeModelInfo(data);
    normalizeGlobalSequences(data);
    const globalSeqCount = data.GlobalSequences?.length || 0;
    const getValidIndexOrNull = (value: any, count: number): number | null => {
        if (value === undefined || value === null) return null
        const num = Number(value)
        if (!Number.isInteger(num) || num < 0) return null
        if (count <= 0 || num >= count) return null
        return num
    }

    normalizeTextures(data);

    // Fix Geoset data
    if (data.Geosets && Array.isArray(data.Geosets)) {
        data.Geosets.forEach((geoset: any) => {
            if (!geoset) return;
            // Use toDynamicFloat32Array for variable length arrays
            if (geoset.Vertices && !(geoset.Vertices instanceof Float32Array)) {
                geoset.Vertices = toDynamicFloat32Array(geoset.Vertices);
            }
            if (geoset.Normals && !(geoset.Normals instanceof Float32Array)) {
                geoset.Normals = toDynamicFloat32Array(geoset.Normals);
            }
            if (geoset.Faces && !(geoset.Faces instanceof Uint16Array)) {
                geoset.Faces = toUint16Array(geoset.Faces);
            }
            if (geoset.VertexGroup) {
                const vertexGroupValues = Array.from(geoset.VertexGroup as unknown as ArrayLike<number>, (value) => Number(value) || 0);
                const maxGroupIndex = vertexGroupValues.reduce((max, value) => Math.max(max, Math.floor(value)), 0);
                const TypedArrayCtor = maxGroupIndex > 255 ? Uint16Array : Uint8Array;
                if (!(geoset.VertexGroup instanceof TypedArrayCtor)) {
                    geoset.VertexGroup = new TypedArrayCtor(vertexGroupValues);
                }
            }
            if (geoset.MinimumExtent && !(geoset.MinimumExtent instanceof Float32Array)) {
                geoset.MinimumExtent = toFloat32Array(geoset.MinimumExtent);
            }
            if (geoset.MaximumExtent && !(geoset.MaximumExtent instanceof Float32Array)) {
                geoset.MaximumExtent = toFloat32Array(geoset.MaximumExtent);
            }
            if (geoset.TVertices) {
                if (Array.isArray(geoset.TVertices)) {
                    // Array of arrays format (from mdx parser usually)
                    geoset.TVertices = geoset.TVertices.map((tv: any) =>
                        tv instanceof Float32Array ? tv : toDynamicFloat32Array(tv)
                    );
                } else if (geoset.TVertices instanceof Float32Array) {
                    // Single large array already typed
                    geoset.TVertices = [geoset.TVertices];
                } else {
                    // Single object-like array or unknown format
                    geoset.TVertices = [toDynamicFloat32Array(geoset.TVertices)];
                }
            }
            if (geoset.Tangents && !(geoset.Tangents instanceof Float32Array)) {
                geoset.Tangents = toDynamicFloat32Array(geoset.Tangents);
            }
            if (geoset.SkinWeights && !(geoset.SkinWeights instanceof Uint8Array)) {
                geoset.SkinWeights = toUint8Array(geoset.SkinWeights);
            }
            if (geoset.Anims && Array.isArray(geoset.Anims)) {
                geoset.Anims.forEach((anim: any) => {
                    if (anim.MinimumExtent && !(anim.MinimumExtent instanceof Float32Array)) {
                        anim.MinimumExtent = toFloat32Array(anim.MinimumExtent);
                    }
                    if (anim.MaximumExtent && !(anim.MaximumExtent instanceof Float32Array)) {
                        anim.MaximumExtent = toFloat32Array(anim.MaximumExtent);
                    }
                });
            }

            // Sanity checks for array lengths (prevent corrupt exports)
            const vertexCount = geoset.Vertices ? Math.floor(geoset.Vertices.length / 3) : 0;
            if (geoset.Vertices && geoset.Vertices.length % 3 !== 0) {
                geoset.Vertices = geoset.Vertices.subarray(0, vertexCount * 3);
            }
            if (geoset.Normals) {
                const expected = vertexCount * 3;
                if (geoset.Normals.length !== expected) {
                    const fixed = new Float32Array(expected);
                    fixed.set(geoset.Normals.subarray(0, expected));
                    geoset.Normals = fixed;
                }
            } else if (vertexCount > 0) {
                geoset.Normals = buildFallbackNormals(vertexCount);
            }
            if (geoset.VertexGroup) {
                if (geoset.VertexGroup.length !== vertexCount) {
                    const TypedArrayCtor = geoset.VertexGroup instanceof Uint16Array ? Uint16Array : Uint8Array;
                    const fixed = new TypedArrayCtor(vertexCount);
                    fixed.set(geoset.VertexGroup.subarray(0, vertexCount));
                    geoset.VertexGroup = fixed;
                }
            }
            if (geoset.Faces) {
                const faceCount = Math.floor(geoset.Faces.length / 3);
                if (geoset.Faces.length % 3 !== 0) {
                    geoset.Faces = geoset.Faces.subarray(0, faceCount * 3);
                }
                for (let i = 0; i < geoset.Faces.length; i++) {
                    if (geoset.Faces[i] >= vertexCount || geoset.Faces[i] < 0) {
                        geoset.Faces[i] = 0;
                    }
                }
            }
            if (geoset.TVertices && Array.isArray(geoset.TVertices)) {
                geoset.TVertices = geoset.TVertices.map((tv: any) => {
                    const typed = tv instanceof Float32Array ? tv : toDynamicFloat32Array(tv);
                    const expected = vertexCount * 2;
                    if (typed.length === expected) return typed;
                    const fixed = new Float32Array(expected);
                    fixed.set(typed.subarray(0, expected));
                    return fixed;
                });
            } else if (vertexCount > 0) {
                geoset.TVertices = [new Float32Array(vertexCount * 2)];
            }
            if (geoset.Tangents && geoset.Tangents.length % 4 !== 0) {
                const tangentCount = Math.floor(geoset.Tangents.length / 4);
                geoset.Tangents = geoset.Tangents.subarray(0, tangentCount * 4);
            }
            if (!geoset.Anims) {
                geoset.Anims = [];
            }
        });
    }

    // Fix GeosetAnims
    if (data.GeosetAnims && Array.isArray(data.GeosetAnims)) {
        const geosetCount = data.Geosets?.length || 0;
        const usedGeosetAnimIds = new Set<number>();
        data.GeosetAnims = data.GeosetAnims.filter((anim: any) => {
            const geosetId = anim?.GeosetId;
            if (geosetId === undefined || geosetId === null) return true;
            if (typeof geosetId !== 'number' || geosetId < 0 || geosetId >= geosetCount) return false;
            if (usedGeosetAnimIds.has(geosetId)) return false;
            usedGeosetAnimIds.add(geosetId);
            return true;
        });
        data.GeosetAnims.forEach((anim: any) => {
            if (typeof anim.Flags !== 'number') {
                anim.Flags = 0;
            }
            if (anim.GeosetId === undefined || anim.GeosetId === null) {
                anim.GeosetId = null;
            } else if (typeof anim.GeosetId !== 'number' || anim.GeosetId < 0) {
                anim.GeosetId = null;
            }
            if (anim.Color instanceof Float32Array) {
                // Keep static color
            } else if (anim.Color && Array.isArray(anim.Color)) {
                anim.Color = new Float32Array(anim.Color.slice(0, 3));
            } else if (anim.Color && typeof anim.Color === 'object') {
                if (Array.isArray((anim.Color as any).Keys)) {
                    anim.Color = ensureAnimVector(anim.Color, 3, false, [1, 1, 1], globalSeqCount) ?? new Float32Array([1, 1, 1]);
                } else {
                    anim.Color = toFloat32Array(anim.Color, 3);
                }
            }
            if (anim.Alpha && typeof anim.Alpha === 'object') {
                anim.Alpha = ensureAnimVector(anim.Alpha, 1, false, undefined, globalSeqCount) ?? anim.Alpha;
            }
            if (typeof anim.Alpha === 'number') {
                if (anim.Alpha < 0) anim.Alpha = 0;
                if (anim.Alpha > 1) anim.Alpha = 1;
            }
            if (typeof anim.UseColor === 'boolean') {
                const flags = typeof anim.Flags === 'number' ? anim.Flags : 0;
                anim.Flags = anim.UseColor ? (flags | 2) : (flags & ~2);
            }
            if (typeof anim.DropShadow === 'boolean') {
                const flags = typeof anim.Flags === 'number' ? anim.Flags : 0;
                anim.Flags = anim.DropShadow ? (flags | 1) : (flags & ~1);
            }
        });
    }

    // Fix TextureAnims (TVertexAnim)
    if (data.TextureAnims && Array.isArray(data.TextureAnims)) {
        data.TextureAnims.forEach((anim: any) => {
            if (anim.Translation) {
                anim.Translation = ensureAnimVector(anim.Translation, 3, false, [0, 0, 0], globalSeqCount);
            }
            if (anim.Rotation) {
                anim.Rotation = ensureAnimVector(anim.Rotation, 4, false, [0, 0, 0, 1], globalSeqCount);
            }
            if (anim.Scaling) {
                anim.Scaling = ensureAnimVector(anim.Scaling, 3, false, [1, 1, 1], globalSeqCount);
            }
        });
    }

    // Fix PivotPoints
    if (data.PivotPoints && Array.isArray(data.PivotPoints)) {
        data.PivotPoints = data.PivotPoints.map((pp: any) =>
            pp instanceof Float32Array ? pp : toFloat32Array(pp)
        );
    }

    // Fix Node PivotPoints
    const nodeArrays = ['Nodes', 'Bones', 'Helpers', 'Attachments', 'Lights',
        'ParticleEmitters', 'ParticleEmitters2', 'RibbonEmitters',
        'EventObjects', 'CollisionShapes', 'Cameras'];
    nodeArrays.forEach(key => {
        if (data[key] && Array.isArray(data[key])) {
            data[key].forEach((node: any) => {
                if (node.PivotPoint && !(node.PivotPoint instanceof Float32Array)) {
                    node.PivotPoint = toFloat32Array(node.PivotPoint);
                }
            });
        }
    });

    // Fix Light node properties - ensure Color/AmbColor are Float32Array or valid AnimVector, and Visibility is valid
    if (data.Lights && Array.isArray(data.Lights)) {
        // console.log(`[MainLayout] prepareModelDataForSave: Processing ${data.Lights.length} lights`);
        data.Lights.forEach((light: any) => {
            // FIRST: Map our naming convention to war3-model naming convention
            // This must happen BEFORE we process/default the war3-model properties!

            // Map AmbientColor (our naming) to AmbColor (war3-model naming)
            if (light.AmbientColor !== undefined) {
                if (Array.isArray(light.AmbientColor)) {
                    light.AmbColor = new Float32Array(light.AmbientColor);
                } else if (light.AmbientColor instanceof Float32Array) {
                    light.AmbColor = light.AmbientColor;
                }
                // Don't delete AmbientColor - keep for UI compatibility
            }

            // Map AmbientIntensity to AmbIntensity
            if (light.AmbientIntensity !== undefined) {
                light.AmbIntensity = light.AmbientIntensity;
            }

            // SECOND: Process Color - should be Float32Array or AnimVector with Keys array
            if (light.Color) {
                if (Array.isArray(light.Color)) {
                    light.Color = new Float32Array(light.Color);
                } else if (typeof light.Color === 'object' && !(light.Color instanceof Float32Array)) {
                    if (isAnimVector(light.Color)) {
                        light.Color = fixAnimVector(light.Color, 3, false, [1, 1, 1], globalSeqCount);
                    } else {
                        // Invalid AnimVector, convert to static color
                        light.Color = toFloat32Array(light.Color, 3);
                    }
                }
            } else {
                light.Color = new Float32Array([1, 1, 1]);
            }

            // THIRD: Process AmbColor (after mapping from AmbientColor)
            if (light.AmbColor) {
                if (Array.isArray(light.AmbColor)) {
                    light.AmbColor = new Float32Array(light.AmbColor);
                } else if (typeof light.AmbColor === 'object' && !(light.AmbColor instanceof Float32Array)) {
                    if (isAnimVector(light.AmbColor)) {
                        light.AmbColor = fixAnimVector(light.AmbColor, 3, false, [1, 1, 1], globalSeqCount);
                    } else {
                        light.AmbColor = toFloat32Array(light.AmbColor, 3);
                    }
                }
            } else {
                light.AmbColor = new Float32Array([1, 1, 1]);
            }

            // Ensure AmbIntensity exists (after mapping from AmbientIntensity)
            if (light.AmbIntensity === undefined) {
                light.AmbIntensity = 0;
            }
            if (light.Intensity === undefined) {
                light.Intensity = 1;
            }
            if (light.AttenuationStart === undefined || light.AttenuationStart === null) {
                light.AttenuationStart = 80;
            }
            if (light.AttenuationEnd === undefined || light.AttenuationEnd === null) {
                light.AttenuationEnd = 200;
            }

            // Ensure static numeric properties exist as numbers (not AnimVector if they're simple values)
            if (light.Intensity !== undefined && typeof light.Intensity === 'object' && light.Intensity !== null) {
                if (isAnimVector(light.Intensity)) {
                    light.Intensity = fixAnimVector(light.Intensity, 1, false, undefined, globalSeqCount);
                } else {
                    light.Intensity = 1; // Default to 1 if malformed
                }
            }

            if (light.AmbIntensity !== undefined && typeof light.AmbIntensity === 'object' && light.AmbIntensity !== null) {
                if (isAnimVector(light.AmbIntensity)) {
                    light.AmbIntensity = fixAnimVector(light.AmbIntensity, 1, false, undefined, globalSeqCount);
                } else {
                    light.AmbIntensity = 0; // Default ambient intensity
                }
            }

            if (light.AttenuationStart !== undefined && typeof light.AttenuationStart === 'object' && light.AttenuationStart !== null) {
                if (isAnimVector(light.AttenuationStart)) {
                    light.AttenuationStart = fixAnimVector(light.AttenuationStart, 1, true, undefined, globalSeqCount);
                } else {
                    light.AttenuationStart = 80;
                }
            }

            if (light.AttenuationEnd !== undefined && typeof light.AttenuationEnd === 'object' && light.AttenuationEnd !== null) {
                if (isAnimVector(light.AttenuationEnd)) {
                    light.AttenuationEnd = fixAnimVector(light.AttenuationEnd, 1, true, undefined, globalSeqCount);
                } else {
                    light.AttenuationEnd = 200;
                }
            }

            // Visibility - must be undefined or a valid AnimVector, NOT a number
            // In war3-model, if Visibility is present, it must be an AnimVector
            if (light.Visibility !== undefined) {
                if (typeof light.Visibility === 'number') {
                    // Static visibility - just remove it (defaults to visible)
                    delete light.Visibility;
                } else if (typeof light.Visibility === 'object' && light.Visibility !== null) {
                    if (isAnimVector(light.Visibility)) {
                        light.Visibility = fixAnimVector(light.Visibility, 1, false, undefined, globalSeqCount);
                    } else {
                        // Malformed AnimVector - remove it
                        delete light.Visibility;
                    }
                }
            }

            light.LightType = typeMap[light.LightType] ?? 0;


            // console.log(`[MainLayout] Light "${light.Name}": Type=${light.LightType}, Intensity=${light.Intensity}, AmbIntensity=${light.AmbIntensity}, AmbColor=[${light.AmbColor[0]?.toFixed(2)},${light.AmbColor[1]?.toFixed(2)},${light.AmbColor[2]?.toFixed(2)}]`);
        });
    }
    // Fix ParticleEmitter2 Flags - convert boolean properties to bitmask
    // ParticleEmitter2Flags: Unshaded=32768, SortPrimsFarZ=65536, LineEmitter=131072,
    //                        Unfogged=262144, ModelSpace=524288, XYQuad=1048576
    // ParticleEmitter2FramesFlags: Head=1, Tail=2
    if (data.ParticleEmitters2 && Array.isArray(data.ParticleEmitters2)) {
        // console.log(`[MainLayout] prepareModelDataForSave: Processing ${data.ParticleEmitters2.length} particle emitters`);
        data.ParticleEmitters2.forEach((emitter: any) => {
            const animProps: Array<{ prop: string, animKey: string }> = [
                { prop: 'EmissionRate', animKey: 'EmissionRateAnim' },
                { prop: 'Speed', animKey: 'SpeedAnim' },
                { prop: 'Variation', animKey: 'VariationAnim' },
                { prop: 'Latitude', animKey: 'LatitudeAnim' },
                { prop: 'Width', animKey: 'WidthAnim' },
                { prop: 'Length', animKey: 'LengthAnim' },
                { prop: 'Gravity', animKey: 'GravityAnim' },
                { prop: 'Visibility', animKey: 'VisibilityAnim' },
            ];

            const fixEmitterAnimProps = (emitter: any, props: typeof animProps) => {
                const removeEmptyAnimVector = (target: any, key: string) => {
                    if (isAnimVector(target[key]) && (!Array.isArray(target[key].Keys) || target[key].Keys.length === 0)) {
                        delete target[key]
                    }
                }

                const ensureScalarZeroAtFrame0 = (track: any) => {
                    if (!isAnimVector(track)) return
                    if (!Array.isArray(track.Keys)) {
                        track.Keys = []
                    }
                    const hasFrame0 = track.Keys.some((key: any) => Number(key?.Frame) === 0)
                    if (!hasFrame0) {
                        track.Keys.push({
                            Frame: 0,
                            Vector: toTypedVector([0], 1, false, [0])
                        })
                    }
                    track.Keys.sort((a: any, b: any) => Number(a?.Frame ?? 0) - Number(b?.Frame ?? 0))
                }

                props.forEach(({ prop, animKey }) => {
                    if (!emitter[prop] && emitter[animKey]) {
                        emitter[prop] = emitter[animKey];
                    }
                    if (isAnimVector(emitter[prop])) {
                        emitter[prop] = fixAnimVector(emitter[prop], 1, false, undefined, globalSeqCount);
                    }
                    if (isAnimVector(emitter[animKey])) {
                        emitter[animKey] = fixAnimVector(emitter[animKey], 1, false, undefined, globalSeqCount);
                    }
                    // Width/Length tracks should always have a frame-0 default key (0 -> 0).
                    if (prop === 'Width' || prop === 'Length') {
                        ensureScalarZeroAtFrame0(emitter[prop]);
                        ensureScalarZeroAtFrame0(emitter[animKey]);
                    } else {
                        removeEmptyAnimVector(emitter, prop);
                        removeEmptyAnimVector(emitter, animKey);
                    }
                });
            };

            fixEmitterAnimProps(emitter, animProps);

            // Reconstruct Flags bitmask from individual boolean properties.
            // Preserve existing bits if the boolean is undefined (raw parser output doesn't include booleans).
            const particleFlagMask = 32768 | 65536 | 131072 | 262144 | 524288 | 1048576;
            const baseFlags = typeof emitter.Flags === 'number' ? emitter.Flags : 0;
            let flags = baseFlags & ~particleFlagMask;

            const applyFlag = (prop: string, bit: number) => {
                if (emitter[prop] === true) {
                    flags |= bit;
                } else if (emitter[prop] === false) {
                    // Explicitly cleared
                } else if (baseFlags & bit) {
                    flags |= bit;
                }
            };

            applyFlag('Unshaded', 32768);
            applyFlag('SortPrimsFarZ', 65536);
            applyFlag('LineEmitter', 131072);
            applyFlag('Unfogged', 262144);
            applyFlag('ModelSpace', 524288);
            applyFlag('XYQuad', 1048576);

            emitter.Flags = flags;

            // Reconstruct FrameFlags from Head/Tail booleans
            let frameFlags = 0;
            if (emitter.Head === true) frameFlags |= 1;
            if (emitter.Tail === true) frameFlags |= 2;
            if (emitter.Head === undefined && emitter.Tail === undefined) {
                frameFlags = emitter.FrameFlags || 0;
            }
            emitter.FrameFlags = frameFlags;

            // Fix Squirt
            if (emitter.Squirt !== undefined) {
                emitter.Squirt = !!emitter.Squirt;
            }

            const numberOrDefault = (value: any, fallback: number): number => {
                const num = Number(value);
                return Number.isFinite(num) ? num : fallback;
            };

            const toSegmentColorVector = (color: any): Float32Array => {
                const source = Array.isArray(color) && color.length === 1 && (Array.isArray(color[0]) || ArrayBuffer.isView(color[0]))
                    ? color[0]
                    : color

                if (source instanceof Float32Array && source.length >= 3) {
                    return new Float32Array([source[0], source[1], source[2]])
                }
                if (Array.isArray(source) || ArrayBuffer.isView(source)) {
                    const arr = source as ArrayLike<number>
                    return new Float32Array([
                        numberOrDefault(arr[0], 1),
                        numberOrDefault(arr[1], 1),
                        numberOrDefault(arr[2], 1)
                    ])
                }
                if (source && typeof source === 'object') {
                    return new Float32Array([
                        numberOrDefault(source[0], 1),
                        numberOrDefault(source[1], 1),
                        numberOrDefault(source[2], 1)
                    ])
                }
                return new Float32Array([1, 1, 1])
            }

            // Fix SegmentColor - must be array of 3 Float32Array(3) color vectors
            if (emitter.SegmentColor) {
                if (Array.isArray(emitter.SegmentColor)) {
                    emitter.SegmentColor = emitter.SegmentColor.map(toSegmentColorVector);
                    // Ensure exactly 3 colors
                    while (emitter.SegmentColor.length < 3) {
                        emitter.SegmentColor.push(new Float32Array([1, 1, 1]));
                    }
                } else {
                    // Invalid SegmentColor, set default
                    emitter.SegmentColor = [
                        new Float32Array([1, 1, 1]),
                        new Float32Array([1, 1, 1]),
                        new Float32Array([1, 1, 1])
                    ];
                }
            }

            // Fix Alpha - must be Uint8Array(3) or array of 3 numbers
            if (emitter.Alpha) {
                if (!(emitter.Alpha instanceof Uint8Array)) {
                    if (Array.isArray(emitter.Alpha)) {
                        emitter.Alpha = new Uint8Array(emitter.Alpha);
                    } else if (typeof emitter.Alpha === 'object') {
                        emitter.Alpha = new Uint8Array([
                            numberOrDefault(emitter.Alpha[0], 255),
                            numberOrDefault(emitter.Alpha[1], 255),
                            numberOrDefault(emitter.Alpha[2], 0)
                        ]);
                    } else {
                        emitter.Alpha = new Uint8Array([255, 255, 0]);
                    }
                }
            }

            // Fix ParticleScaling - must be Float32Array(3)
            if (emitter.ParticleScaling) {
                if (!(emitter.ParticleScaling instanceof Float32Array)) {
                    if (Array.isArray(emitter.ParticleScaling)) {
                        emitter.ParticleScaling = new Float32Array(emitter.ParticleScaling);
                    } else if (typeof emitter.ParticleScaling === 'object') {
                        emitter.ParticleScaling = new Float32Array([
                            numberOrDefault(emitter.ParticleScaling[0], 1),
                            numberOrDefault(emitter.ParticleScaling[1], 1),
                            numberOrDefault(emitter.ParticleScaling[2], 1)
                        ]);
                    } else {
                        emitter.ParticleScaling = new Float32Array([1, 1, 1]);
                    }
                }
            }

            // Fix UV animations - must be Uint32Array(3)
            const uvAnims = ['LifeSpanUVAnim', 'DecayUVAnim', 'TailUVAnim', 'TailDecayUVAnim'];
            uvAnims.forEach(animName => {
                if (emitter[animName]) {
                    if (!(emitter[animName] instanceof Uint32Array)) {
                        emitter[animName] = new Uint32Array(emitter[animName]);
                    }
                } else {
                    emitter[animName] = new Uint32Array([0, 0, 1]); // Default start, end, repeat
                }
            });

            // Fix Squirt
            if (emitter.Squirt !== undefined) {
                emitter.Squirt = !!emitter.Squirt;
            }

            // console.log(`[MainLayout] ParticleEmitter2 "${emitter.Name}": Flags=${flags}, FrameFlags=${frameFlags}`);
        });
    }

    // Fix ParticleEmitterPopcorn
    if (data.ParticleEmitterPopcorns && Array.isArray(data.ParticleEmitterPopcorns)) {
        data.ParticleEmitterPopcorns.forEach((emitter: any) => {
            const animProps: Array<{ prop: string, animKey: string }> = [
                { prop: 'LifeSpan', animKey: 'LifeSpanAnim' },
                { prop: 'EmissionRate', animKey: 'EmissionRateAnim' },
                { prop: 'Speed', animKey: 'SpeedAnim' },
                { prop: 'Color', animKey: 'ColorAnim' },
                { prop: 'Alpha', animKey: 'AlphaAnim' },
                { prop: 'Visibility', animKey: 'VisibilityAnim' },
            ];

            animProps.forEach(({ prop, animKey }) => {
                if (!emitter[prop] && emitter[animKey]) {
                    emitter[prop] = emitter[animKey];
                }
                if (isAnimVector(emitter[prop])) {
                    emitter[prop] = fixAnimVector(emitter[prop], 1, false, undefined, globalSeqCount);
                }
                if (isAnimVector(emitter[animKey])) {
                    emitter[animKey] = fixAnimVector(emitter[animKey], 1, false, undefined, globalSeqCount);
                }
            });

            // Ensure Color is Float32Array if static
            if (emitter.Color && Array.isArray(emitter.Color)) {
                emitter.Color = new Float32Array(emitter.Color);
            }
        });
    }

    // Fix RibbonEmitters
    if (data.RibbonEmitters && Array.isArray(data.RibbonEmitters)) {
        // console.log(`[MainLayout] prepareModelDataForSave: Processing ${data.RibbonEmitters.length} ribbon emitters`);
        data.RibbonEmitters.forEach((emitter: any) => {
            const animProps: Array<{ prop: string, animKey: string }> = [
                { prop: 'Height', animKey: 'HeightAnim' },
                { prop: 'Alpha', animKey: 'AlphaAnim' },
                { prop: 'Color', animKey: 'ColorAnim' },
                { prop: 'Visibility', animKey: 'VisibilityAnim' },
            ];

            animProps.forEach(({ prop, animKey }) => {
                if (!emitter[prop] && emitter[animKey]) {
                    emitter[prop] = emitter[animKey];
                }
                if (isAnimVector(emitter[prop])) {
                    emitter[prop] = fixAnimVector(emitter[prop], 1, false, undefined, globalSeqCount);
                }
                if (isAnimVector(emitter[animKey])) {
                    emitter[animKey] = fixAnimVector(emitter[animKey], 1, false, undefined, globalSeqCount);
                }
            });

            // Ensure Color is Float32Array if static
            if (emitter.Color && Array.isArray(emitter.Color)) {
                emitter.Color = new Float32Array(emitter.Color);
            }
        });
    }

    // Fix Cameras - ensure Position and TargetPosition are Float32Arrays
    if (data.Cameras && Array.isArray(data.Cameras)) {
        // console.log(`[MainLayout] prepareModelDataForSave: Processing ${data.Cameras.length} cameras`);
        data.Cameras.forEach((camera: any) => {
            if (camera.FieldOfView === undefined || camera.FieldOfView === null) {
                camera.FieldOfView = 0.7853; // ~45 deg
            }
            if (camera.NearClip === undefined || camera.NearClip === null) {
                camera.NearClip = 16;
            }
            if (camera.FarClip === undefined || camera.FarClip === null) {
                camera.FarClip = 5000;
            }
            if (camera.Position) {
                camera.Position = toFloat32Array(camera.Position, 3);
            } else {
                camera.Position = new Float32Array([0, 0, 0]);
            }
            if (camera.TargetPosition) {
                camera.TargetPosition = toFloat32Array(camera.TargetPosition, 3);
            } else {
                camera.TargetPosition = new Float32Array([0, 0, 0]);
            }
            if (camera.Target !== undefined && !(camera.Target instanceof Float32Array)) {
                camera.Target = toFloat32Array(camera.Target, 3);
            }
            if (camera.Translation) {
                camera.Translation = ensureAnimVector(camera.Translation, 3, false, [0, 0, 0], globalSeqCount);
            }
            if (camera.TargetTranslation) {
                camera.TargetTranslation = ensureAnimVector(camera.TargetTranslation, 3, false, [0, 0, 0], globalSeqCount);
            }
            if (camera.Rotation) {
                camera.Rotation = ensureAnimVector(camera.Rotation, 1, false, [0], globalSeqCount);
            }
        });
    }

    // Fix CollisionShapes - ensure Vertices are Float32Arrays
    if (data.CollisionShapes && Array.isArray(data.CollisionShapes)) {
        // console.log(`[MainLayout] prepareModelDataForSave: Processing ${data.CollisionShapes.length} collision shapes`);
        data.CollisionShapes.forEach((shape: any) => {
            // Shape 0 = Box (6 floats), Shape 2 = Sphere (3 floats)
            const vertexCount = shape.Shape === 0 ? 6 : 3;
            if (shape.Vertices) {
                // Fix: Vertex1/Vertex2/Vertices in CollisionShape are vectors [x, y, z]
                // and should NOT be flattened into a single large Float32Array if they are stored as arrays of arrays.
                // However, war3-model MDX generator expects a flattened Float32Array for 'Vertices' field.
                if (Array.isArray(shape.Vertices[0])) {
                    // It's [[x,y,z], [x,y,z]] - flatten it
                    const flattened = new Float32Array(shape.Vertices.length * 3);
                    for (let i = 0; i < shape.Vertices.length; i++) {
                        flattened[i * 3] = shape.Vertices[i][0];
                        flattened[i * 3 + 1] = shape.Vertices[i][1];
                        flattened[i * 3 + 2] = shape.Vertices[i][2];
                    }
                    shape.Vertices = flattened;
                } else {
                    shape.Vertices = toFloat32Array(shape.Vertices, vertexCount);
                }
            } else {
                shape.Vertices = new Float32Array(vertexCount);
            }
            fixNode(shape, globalSeqCount); // CollisionShapes are also Nodes
        });
    }

    // Fix all node-type arrays to ensure AnimVector data is valid
    const nodeArrayNames = ['Bones', 'Helpers', 'Attachments', 'EventObjects', 'Lights', 'RibbonEmitters', 'ParticleEmitters', 'ParticleEmitters2', 'ParticleEmitterPopcorns'];
    nodeArrayNames.forEach(arrayName => {
        if (data[arrayName] && Array.isArray(data[arrayName])) {
            data[arrayName].forEach((node: any) => fixNode(node, globalSeqCount));
        }
    });

    // Fix Bone-specific geoset references. Warcraft III is less forgiving than the parser:
    // a Bone.GeosetAnimId that points past GeosetAnims can make the model fail to render.
    if (data.Bones && Array.isArray(data.Bones)) {
        const geosetCount = data.Geosets?.length || 0
        const geosetAnimCount = data.GeosetAnims?.length || 0
        data.Bones.forEach((bone: any) => {
            bone.GeosetId = getValidIndexOrNull(bone.GeosetId, geosetCount)
            bone.GeosetAnimId = getValidIndexOrNull(bone.GeosetAnimId, geosetAnimCount)
        })
    }

    // Fix Attachment-specific properties
    if (data.Attachments && Array.isArray(data.Attachments)) {
        data.Attachments.forEach((attachment: any) => {
            // Ensure AttachmentID is defined
            if (attachment.AttachmentID === undefined) {
                attachment.AttachmentID = 0;
            }
            // Path must be a string (empty is fine for war3-model)
            if (attachment.Path === undefined) {
                attachment.Path = '';
            }
            // Visibility is an AnimVector - fix or remove if invalid
            if (attachment.Visibility) {
                attachment.Visibility = fixAnimVector(attachment.Visibility, 1, false, undefined, globalSeqCount);
                if (!attachment.Visibility || !attachment.Visibility.Keys || attachment.Visibility.Keys.length === 0) {
                    delete attachment.Visibility;
                }
            }
        });
    }

    // Fix Geosets - ensure TotalGroupsCount is consistent with Groups array
    if (data.Geosets && Array.isArray(data.Geosets)) {
        // console.log(`[MainLayout] prepareModelDataForSave: Processing ${data.Geosets.length} geosets`);
        const materialCount = data.Materials?.length || 0;
        data.Geosets.forEach((geoset: any, index: number) => {
            const vertexCount = geoset.Vertices ? Math.floor(geoset.Vertices.length / 3) : 0;

            // Normalize Groups to number[][]
            if (geoset.Groups && Array.isArray(geoset.Groups)) {
                geoset.Groups = geoset.Groups.map((group: any) => {
                    const matrices = Array.isArray(group)
                        ? group
                        : Array.isArray(group?.matrices)
                            ? group.matrices
                            : [];
                    return matrices.map((value: any) => {
                        const num = Number(value);
                        if (!Number.isFinite(num) || num < 0) return 0;
                        return Math.floor(num);
                    });
                });
            } else if (!geoset.Groups) {
                geoset.Groups = [];
            }

            if (geoset.Groups.length === 0 && vertexCount > 0) {
                geoset.Groups = [[0]];
            }

            // Recalculate TotalGroupsCount from Groups array
            const totalCount = geoset.Groups.reduce((sum: number, group: any) => {
                return sum + (Array.isArray(group) ? group.length : 0);
            }, 0);
            if (geoset.TotalGroupsCount !== totalCount) {                geoset.TotalGroupsCount = totalCount;
            }

            const maxGroupIndex = Math.max(0, geoset.Groups.length - 1);
            const VertexGroupCtor = maxGroupIndex > 255 ? Uint16Array : Uint8Array;

            // Ensure VertexGroup exists and uses a wide-enough integer type
            if (!geoset.VertexGroup) {
                geoset.VertexGroup = new VertexGroupCtor(vertexCount);
            } else if (!(geoset.VertexGroup instanceof VertexGroupCtor)) {
                geoset.VertexGroup = new VertexGroupCtor(Array.from(geoset.VertexGroup as unknown as ArrayLike<number>, (value) => Number(value) || 0));
            }
            if (geoset.VertexGroup.length !== vertexCount) {
                const fixed = new VertexGroupCtor(vertexCount);
                fixed.set(geoset.VertexGroup.subarray(0, vertexCount));
                geoset.VertexGroup = fixed;
            }
            if (maxGroupIndex >= 0) {
                for (let i = 0; i < geoset.VertexGroup.length; i++) {
                    if (geoset.VertexGroup[i] > maxGroupIndex) {
                        geoset.VertexGroup[i] = 0;
                    }
                }
            }

            // MaterialID bounds
            if (typeof geoset.MaterialID !== 'number' || geoset.MaterialID < 0 || (materialCount > 0 && geoset.MaterialID >= materialCount)) {
                geoset.MaterialID = 0;
            }
            if (geoset.SelectionGroup === undefined || geoset.SelectionGroup === null) {
                geoset.SelectionGroup = 0;
            }
            if (geoset.Unselectable === undefined) {
                geoset.Unselectable = false;
            }

            // Ensure Faces is Uint16Array
            if (geoset.Faces && !(geoset.Faces instanceof Uint16Array)) {
                geoset.Faces = toUint16Array(geoset.Faces);
            }
        });
    }

    // Fix Materials - ensure all layer properties are valid for MDX generator
    if (data.Materials && Array.isArray(data.Materials)) {
        // console.log(`[MainLayout] prepareModelDataForSave: Processing ${data.Materials.length} materials`);
        data.Materials.forEach((material: any, matIndex: number) => {
            // Ensure material properties
            if (material.PriorityPlane === undefined) material.PriorityPlane = 0;
            if (material.RenderMode === undefined) material.RenderMode = 0;

            // Rebuild RenderMode from boolean flags when provided
            const renderMask = 1 | 16 | 32;
            const baseRenderMode = typeof material.RenderMode === 'number' ? material.RenderMode : 0;
            let renderMode = baseRenderMode & ~renderMask;
            const applyRenderFlag = (value: any, bit: number) => {
                if (value === true) {
                    renderMode |= bit;
                } else if (value === false) {
                    // Explicitly cleared
                } else if (baseRenderMode & bit) {
                    renderMode |= bit;
                }
            };
            applyRenderFlag(material.ConstantColor, 1);
            const sortPrims = material.SortPrimsFarZ ?? material.SortPrimitivesFarZ;
            applyRenderFlag(sortPrims, 16);
            applyRenderFlag(material.FullResolution, 32);
            material.RenderMode = renderMode;

            if (material.Layers && Array.isArray(material.Layers)) {
                material.Layers.forEach((layer: any, layerIndex: number) => {
                    // FilterMode - required, default to 0 (None)
                    let filterModeValue: any = layer.FilterMode;
                    if (filterModeValue === undefined && layer.filterMode !== undefined) {
                        filterModeValue = layer.filterMode;
                    }
                    if (filterModeValue && typeof filterModeValue === 'object' && 'value' in filterModeValue) {
                        filterModeValue = (filterModeValue as any).value;
                    }
                    if (filterModeValue === undefined || filterModeValue === null) {
                        filterModeValue = 0;
                    }
                    if (typeof filterModeValue === 'string') {
                        const normalized = filterModeValue.replace(/\\s+/g, '').toLowerCase();
                        const map: Record<string, number> = {
                            none: 0,
                            transparent: 1,
                            blend: 2,
                            additive: 3,
                            addalpha: 4,
                            modulate: 5,
                            modulate2x: 6
                        };
                        if (/^\d+$/.test(normalized)) {
                            filterModeValue = Number.parseInt(normalized, 10);
                        } else {
                            filterModeValue = map[normalized] ?? 0;
                        }
                    }
                    if (typeof filterModeValue !== 'number' || !Number.isFinite(filterModeValue)) {
                        filterModeValue = 0;
                    }
                    layer.FilterMode = Math.max(0, Math.min(6, Math.floor(filterModeValue)));

                    // Shading - required, default to 0
                    const shadingMask = 1 | 2 | 16 | 32 | 64 | 128;
                    const baseShading = typeof layer.Shading === 'number' ? layer.Shading : 0;
                    let shading = baseShading & ~shadingMask;
                    const applyShadingFlag = (value: any, bit: number) => {
                        if (value === true) {
                            shading |= bit;
                        } else if (value === false) {
                            // Explicitly cleared
                        } else if (baseShading & bit) {
                            shading |= bit;
                        }
                    };
                    applyShadingFlag(layer.Unshaded, 1);
                    const sphereEnv = layer.SphereEnvMap ?? layer.SphereEnvironmentMap;
                    applyShadingFlag(sphereEnv, 2);
                    applyShadingFlag(layer.TwoSided, 16);
                    applyShadingFlag(layer.Unfogged, 32);
                    applyShadingFlag(layer.NoDepthTest, 64);
                    applyShadingFlag(layer.NoDepthSet, 128);
                    layer.Shading = shading;

                    // TextureID - can be number or AnimVector, default to 0
                    if (layer.TextureID === undefined || layer.TextureID === null) {
                        layer.TextureID = 0;
                    } else if (typeof layer.TextureID === 'string') {
                        const parsedTextureId = Number(layer.TextureID);
                        layer.TextureID = Number.isFinite(parsedTextureId) ? Math.floor(parsedTextureId) : 0;
                    } else if (typeof layer.TextureID === 'object') {
                        // Fix AnimVector Key Vectors to be Int32Array
                        layer.TextureID = normalizeTextureIdAnimVector(layer.TextureID, data.Textures?.length || 0, globalSeqCount) ?? layer.TextureID;
                    }
                    if (typeof layer.TextureID === 'number') {
                        const texCount = data.Textures?.length || 0;
                        if (texCount > 0 && (layer.TextureID < 0 || layer.TextureID >= texCount)) {
                            layer.TextureID = 0;
                        }
                    }

                    // TVertexAnimId - can be null or number, convert undefined to null
                    if (layer.TVertexAnimId === undefined && layer.TextureAnimationId !== undefined) {
                        layer.TVertexAnimId = layer.TextureAnimationId;
                    }
                    if (layer.TVertexAnimId === undefined) {
                        layer.TVertexAnimId = null;
                    }
                    if (typeof layer.TVertexAnimId === 'number') {
                        const tvAnimCount = data.TextureAnims?.length || 0;
                        if (layer.TVertexAnimId < 0 || (tvAnimCount > 0 && layer.TVertexAnimId >= tvAnimCount)) {
                            layer.TVertexAnimId = null;
                        }
                    }

                    // CoordId - required, default to 0
                    if (layer.CoordId === undefined || layer.CoordId === null) {
                        layer.CoordId = 0;
                    }

                    // Alpha - required, default to 1
                    if (layer.Alpha === undefined || layer.Alpha === null) {
                        layer.Alpha = 1;
                    } else if (typeof layer.Alpha === 'object') {
                        // Fix AnimVector Key Vectors to be Float32Array
                        layer.Alpha = ensureAnimVector(layer.Alpha, 1, false, undefined, globalSeqCount) ?? layer.Alpha;
                    } else if (typeof layer.Alpha === 'number') {
                        if (layer.Alpha < 0) layer.Alpha = 0;
                        if (layer.Alpha > 1) layer.Alpha = 1;
                    }

                    // Optional HD/extended layer properties
                    if (layer.EmissiveGain !== undefined && layer.EmissiveGain !== null) {
                        if (typeof layer.EmissiveGain === 'object') {
                            layer.EmissiveGain = ensureAnimVector(layer.EmissiveGain, 1, false, undefined, globalSeqCount) ?? layer.EmissiveGain;
                        }
                    }
                    if (layer.FresnelColor !== undefined && layer.FresnelColor !== null) {
                        if (layer.FresnelColor instanceof Float32Array) {
                            // ok
                        } else if (layer.FresnelColor && typeof layer.FresnelColor === 'object' && Array.isArray(layer.FresnelColor.Keys)) {
                            layer.FresnelColor = fixAnimVector(layer.FresnelColor, 3, false, [1, 1, 1], globalSeqCount);
                        } else {
                            layer.FresnelColor = toFloat32Array(layer.FresnelColor, 3);
                        }
                    }
                    if (layer.FresnelOpacity !== undefined && layer.FresnelOpacity !== null) {
                        if (typeof layer.FresnelOpacity === 'object') {
                            layer.FresnelOpacity = ensureAnimVector(layer.FresnelOpacity, 1, false, undefined, globalSeqCount) ?? layer.FresnelOpacity;
                        }
                    }
                    if (layer.FresnelTeamColor !== undefined && layer.FresnelTeamColor !== null) {
                        if (typeof layer.FresnelTeamColor === 'object') {
                            layer.FresnelTeamColor = ensureAnimVector(layer.FresnelTeamColor, 1, false, undefined, globalSeqCount) ?? layer.FresnelTeamColor;
                        }
                    }

                    const extraTextureIds = [
                        'NormalTextureID',
                        'ORMTextureID',
                        'EmissiveTextureID',
                        'TeamColorTextureID',
                        'ReflectionsTextureID'
                    ];
                    extraTextureIds.forEach((key) => {
                        if (layer[key] === undefined || layer[key] === null) return;
                        if (typeof layer[key] === 'object') {
                            layer[key] = normalizeTextureIdAnimVector(layer[key], data.Textures?.length || 0, globalSeqCount) ?? layer[key];
                        }
                        if (typeof layer[key] === 'number') {
                            const texCount = data.Textures?.length || 0;
                            if (texCount > 0 && (layer[key] < 0 || layer[key] >= texCount)) {
                                layer[key] = 0;
                            }
                        }
                    });

                    // console.log(`[MainLayout] Material[${matIndex}].Layer[${layerIndex}]: FilterMode=${layer.FilterMode}, Shading=${layer.Shading}, TextureID=${typeof layer.TextureID === 'number' ? layer.TextureID : 'AnimVector'}, TVertexAnimId=${layer.TVertexAnimId}, CoordId=${layer.CoordId}, Alpha=${typeof layer.Alpha === 'number' ? layer.Alpha : 'AnimVector'}`);
                });
            }
        });
    }

    repairClassicModelData(data);

    return data;
}

