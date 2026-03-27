import { Model, Sequence, Node, AnimVector, NodeFlags, Layer, TVertexAnim, Light, LightType } from '../model';
import { mat4, vec3, quat, mat3 } from 'gl-matrix';
import { NodeWrapper, RendererData, LightResult } from './rendererData';
import { ModelInterp } from './modelInterp';
import { ParticlesController } from './particles';
import { RibbonsController } from './ribbons';

const translation = vec3.create();
const rotation = quat.create();
const scaling = vec3.create();

const defaultTranslation = vec3.fromValues(0, 0, 0);
const defaultRotation = quat.fromValues(0, 0, 0, 1);
const defaultScaling = vec3.fromValues(1, 1, 1);

const tempParentRotationQuat: quat = quat.create();
const tempParentRotationMat: mat4 = mat4.create();
const tempCameraMat: mat4 = mat4.create();
const tempTransformedPivotPoint: vec3 = vec3.create();
const tempAxis: vec3 = vec3.create();
const tempLockQuat: quat = quat.create();
const tempLockMat: mat4 = mat4.create();
const tempXAxis: vec3 = vec3.create();
const tempCameraVec: vec3 = vec3.create();
const tempCross0: vec3 = vec3.create();
const tempCross1: vec3 = vec3.create();
const tempVec3: vec3 = vec3.create();
const tempColorResult: Float32Array = new Float32Array([1, 1, 1]); // Pre-allocated for findColor
const texCoordMat4 = mat4.create();
const texCoordMat3 = mat3.create();
const identifyMat3 = mat3.create();

// Reusable temporary variables for lighting calculations to reduce GC
const tempLightDirection = vec3.create();
const tempBaseDir = vec3.fromValues(0, 0, -1);
const tempLightRotationQuat = quat.create();
const tempLightColor = vec3.create();
const tempLightAmbientColor = vec3.create();
const tempScaledColor = vec3.create();
const tempScaledAmbient = vec3.create();
const tempLightRotationMat3 = mat3.create();


export class ModelInstance {
    public model: Model;
    public rendererData: RendererData;
    public interp: ModelInterp;
    public enableGeosetAnimColor = true;
    public particlesController: ParticlesController;
    public ribbonsController: RibbonsController;

    public location: vec3 = vec3.create();
    public rotation: quat = quat.create();
    public scale: vec3 = vec3.fromValues(1, 1, 1);
    public worldMatrix: mat4 = mat4.create();
    public dirty = true;

    // Diagnostic: track missing parent warnings
    private _missingParentLogged: Set<number> | null = null;

    constructor(model: Model) {
        this.model = model;
        this.rendererData = {
            model: model,
            frame: 0,
            animation: 0,
            animationInfo: null,
            loop: true,
            globalSequencesFrames: [],
            rootNode: null,
            nodes: [],
            geosetAnims: [],
            geosetAlpha: [],
            materialLayerTextureID: [],
            materialLayerNormalTextureID: [],
            materialLayerOrmTextureID: [],
            materialLayerReflectionTextureID: [],
            teamColor: vec3.fromValues(1, 0, 0),
            cameraPos: vec3.create(),
            cameraQuat: quat.create(),
            lightPos: vec3.fromValues(0, 0, 100),
            lightColor: vec3.fromValues(1, 1, 1),
            shadowBias: 0.001,
            shadowSmoothingStep: 0.001,
            textures: {},
            replaceableTextures: {},
            gpuTextures: {},
            gpuSamplers: [],
            gpuDepthSampler: null,
            requiredEnvMaps: {},
            envTextures: {},
            gpuEnvTextures: {},
            irradianceMap: {},
            gpuIrradianceMap: {},
            prefilteredEnvMap: {},
            gpuPrefilteredEnvMap: {},
            gpuEmptyTexture: null,
            gpuEmptyCubeTexture: null,
            gpuDepthEmptyTexture: null,
            fallbackTexture: null,
        };
        this.interp = new ModelInterp(this.rendererData);
        this.particlesController = new ParticlesController(this.interp, this.rendererData);
        this.ribbonsController = new RibbonsController(this.interp, this.rendererData);

        (this.rendererData as any).modelInstance = this;
        this.initNodes();
        this.initGlobalSequences();
        this.initMaterialLayers();
    }

    private initNodes() {
        // Initialize nodes similar to ModelRenderer
        const nodes = this.model.Nodes;

        // Create a VIRTUAL root node that can hold multiple root-level children
        // This is crucial for models with multiple parentless nodes (Camera, Collision, etc.)
        this.rendererData.rootNode = {
            node: {
                Name: 'VirtualRoot',
                ObjectId: -1,
                Parent: -1,
                Translation: {},
                Rotation: {},
                Scaling: {}
            } as Node,
            matrix: mat4.create(),
            childs: []
        };

        if (nodes) {
            // IMPORTANT: Store nodes by ObjectId, not array index!
            // This is because particles.ts accesses nodes via this.rendererData.nodes[emitter.props.ObjectId]
            // If we use array index, the lookup will fail when ObjectId != array index
            for (let i = 0; i < nodes.length; ++i) {
                const node = nodes[i];
                const nodeId = node.ObjectId !== undefined ? node.ObjectId : i;
                this.rendererData.nodes[nodeId] = {
                    node: node,
                    matrix: mat4.create(),
                    childs: []
                };
            }

            for (let i = 0; i < nodes.length; ++i) {
                const node = nodes[i];
                const nodeId = node.ObjectId !== undefined ? node.ObjectId : i;
                let parentNodeData = null;

                if (node.Parent !== undefined && node.Parent !== -1) {
                    // Access parent by ObjectId (Parent IS the ObjectId of the parent node)
                    if (this.rendererData.nodes[node.Parent]) {
                        parentNodeData = this.rendererData.nodes[node.Parent];
                    }
                }

                if (parentNodeData) {
                    parentNodeData.childs.push(this.rendererData.nodes[nodeId]);
                } else {
                    // Node has no parent - add to virtual root's children
                    // BUG FIX: Previously only the LAST parentless node became rootNode,
                    // overwriting others (like Camera, Collision). Now ALL parentless nodes
                    // become children of the virtual root.
                    this.rendererData.rootNode.childs.push(this.rendererData.nodes[nodeId]);
                }
            }
        }
    }

    /**
     * Reinitializes rendererData.nodes from the current model.Nodes array.
     * Call this when new nodes are added to the model to ensure they are
     * accessible for particle emitters and other node-dependent features.
     */
    public syncNodes(): void {
        // Clear existing nodes array and root children
        this.rendererData.nodes = [];
        if (this.rendererData.rootNode) {
            this.rendererData.rootNode.childs = [];
        }

        // Reinitialize nodes from current model
        this.initNodes();
    }

    private initGlobalSequences() {
        if (this.model.GlobalSequences) {
            for (let i = 0; i < this.model.GlobalSequences.length; ++i) {
                this.rendererData.globalSequencesFrames[i] = 0;
            }
        }
    }

    /**
     * Synchronizes globalSequencesFrames with model.GlobalSequences.
     * Call this when new GlobalSequences are added to ensure TextureAnimations
     * using those sequences can animate correctly.
     */
    public syncGlobalSequences(): void {
        if (!this.model.GlobalSequences) return;

        // Extend globalSequencesFrames array for any new GlobalSequences
        const currentLength = this.rendererData.globalSequencesFrames.length;
        const modelLength = this.model.GlobalSequences.length;

        if (modelLength > currentLength) {
            for (let i = currentLength; i < modelLength; ++i) {
                this.rendererData.globalSequencesFrames[i] = 0;
            }
        } else if (modelLength < currentLength) {
            // Trim if GlobalSequences were removed
            this.rendererData.globalSequencesFrames.length = modelLength;
        }
    }

    public setMaterials(materials: any[]) {
        this.model.Materials = materials;
        this.initMaterialLayers();
    }

    /**
     * Reinitializes materialLayerTextureID from the current model.Materials array.
     * Call this when materials are added/modified to ensure the renderer has
     * up-to-date texture ID lookups without requiring a full renderer reload.
     */
    public syncMaterials(): void {
        // Clear existing arrays
        this.rendererData.materialLayerTextureID = [];
        this.rendererData.materialLayerNormalTextureID = [];
        this.rendererData.materialLayerOrmTextureID = [];
        this.rendererData.materialLayerReflectionTextureID = [];

        // Reinitialize from current model
        this.initMaterialLayers();
    }

    private initMaterialLayers() {
        if (this.model.Materials) {
            for (let i = 0; i < this.model.Materials.length; ++i) {
                const material = this.model.Materials[i];
                this.rendererData.materialLayerTextureID[i] = [];
                this.rendererData.materialLayerNormalTextureID[i] = [];
                this.rendererData.materialLayerOrmTextureID[i] = [];
                this.rendererData.materialLayerReflectionTextureID[i] = [];

                for (let j = 0; j < material.Layers.length; ++j) {
                    const layer = material.Layers[j];
                    this.rendererData.materialLayerTextureID[i][j] = (typeof layer.TextureID === 'number' && layer.TextureID >= 0) ? layer.TextureID : 0;

                    if (layer.NormalTextureID !== undefined) {
                        this.rendererData.materialLayerNormalTextureID[i][j] = (typeof layer.NormalTextureID === 'number' && layer.NormalTextureID >= 0) ? layer.NormalTextureID : 0;
                    }
                    if (layer.ORMTextureID !== undefined) {
                        this.rendererData.materialLayerOrmTextureID[i][j] = (typeof layer.ORMTextureID === 'number' && layer.ORMTextureID >= 0) ? layer.ORMTextureID : 0;
                    }
                    if (layer.ReflectionsTextureID !== undefined) {
                        this.rendererData.materialLayerReflectionTextureID[i][j] = (typeof layer.ReflectionsTextureID === 'number' && layer.ReflectionsTextureID >= 0) ? layer.ReflectionsTextureID : 0;
                    }
                }
            }
        }

        if (this.model.GeosetAnims) {
            for (const anim of this.model.GeosetAnims) {
                this.rendererData.geosetAnims[anim.GeosetId] = anim;
            }
        }
    }

    public update(delta: number) {
        this.rendererData.frame += delta;
        if (this.rendererData.animationInfo) {
            // Apply a small float threshold to prevent rounding errors during timeline
            // scrub simulation loop from overshooting Interval[1] and accidentally wrapping back to 0.
            if (this.rendererData.frame > this.rendererData.animationInfo.Interval[1] + 0.001) {
                if (this.rendererData.loop) {
                    this.rendererData.frame = this.rendererData.animationInfo.Interval[0];
                } else {
                    this.rendererData.frame = this.rendererData.animationInfo.Interval[1];
                }
            }
        }
        this.updateGlobalSequences(delta);

        this.updateNode(this.rendererData.rootNode);

        const geosets = Array.isArray(this.model?.Geosets) ? this.model.Geosets : [];
        const materials = Array.isArray(this.model?.Materials) ? this.model.Materials : [];

        for (let i = 0; i < geosets.length; ++i) {
            this.rendererData.geosetAlpha[i] = this.findAlpha(i);
        }

        for (let materialId = 0; materialId < this.rendererData.materialLayerTextureID.length; ++materialId) {
            const material = materials[materialId];
            const materialLayers = Array.isArray(material?.Layers) ? material.Layers : [];
            for (let layerId = 0; layerId < this.rendererData.materialLayerTextureID[materialId].length; ++layerId) {
                const layer = materialLayers[layerId];
                if (!layer) continue;
                const TextureID: AnimVector | number = layer.TextureID;
                const NormalTextureID: AnimVector | number = layer.NormalTextureID;
                const ORMTextureID: AnimVector | number = layer.ORMTextureID;
                const ReflectionsTextureID: AnimVector | number = layer.ReflectionsTextureID;
                const resolveTrackTextureId = (value: AnimVector | number | undefined, fallback: number): number => {
                    if (typeof value === 'number') {
                        return value >= 0 ? value : fallback;
                    }
                    if (!value) {
                        return fallback;
                    }
                    const interpValue = this.interp.num(value);
                    if (!Number.isFinite(interpValue as number)) {
                        return fallback;
                    }
                    const id = Math.floor(interpValue as number);
                    return id >= 0 ? id : fallback;
                };
                const defaultTextureID = (typeof TextureID === 'number' && TextureID >= 0) ? TextureID : 0;

                // Texture track is an integer index. When the current sequence has no keys,
                // keep the layer default ID instead of falling back to 0.
                this.rendererData.materialLayerTextureID[materialId][layerId] = resolveTrackTextureId(TextureID, defaultTextureID);
                if (typeof NormalTextureID !== 'undefined') {
                    const defaultNormalTextureID = (typeof NormalTextureID === 'number' && NormalTextureID >= 0) ? NormalTextureID : 0;
                    this.rendererData.materialLayerNormalTextureID[materialId][layerId] = resolveTrackTextureId(NormalTextureID, defaultNormalTextureID);
                }
                if (typeof ORMTextureID !== 'undefined') {
                    const defaultOrmTextureID = (typeof ORMTextureID === 'number' && ORMTextureID >= 0) ? ORMTextureID : 0;
                    this.rendererData.materialLayerOrmTextureID[materialId][layerId] = resolveTrackTextureId(ORMTextureID, defaultOrmTextureID);
                }
                if (typeof ReflectionsTextureID !== 'undefined') {
                    const defaultReflectionsTextureID = (typeof ReflectionsTextureID === 'number' && ReflectionsTextureID >= 0) ? ReflectionsTextureID : 0;
                    this.rendererData.materialLayerReflectionTextureID[materialId][layerId] = resolveTrackTextureId(ReflectionsTextureID, defaultReflectionsTextureID);
                }
            }
        }

        this.particlesController.update(delta);
        this.ribbonsController.update(delta);
    }

    public setLocation(location: vec3): void {
        vec3.copy(this.location, location);
        this.dirty = true;
    }

    public setRotation(rotation: quat): void {
        quat.copy(this.rotation, rotation);
        this.dirty = true;
    }

    public setScale(scale: vec3): void {
        vec3.copy(this.scale, scale);
        this.dirty = true;
    }

    public updateWorldMatrix(): void {
        if (this.dirty) {
            mat4.fromRotationTranslationScale(this.worldMatrix, this.rotation, this.location, this.scale);
            this.dirty = false;
        }
    }

    public setSequence(index: number): void {
        this.rendererData.animation = index;
        this.rendererData.frame = 0;

        if (this.model.Sequences && this.model.Sequences[index]) {
            this.rendererData.animationInfo = this.model.Sequences[index];
        } else {
            this.rendererData.animationInfo = null as unknown as Sequence;
        }
    }

    public setFrame(frame: number): void {
        this.rendererData.frame = frame;
    }

    private updateGlobalSequences(delta: number): void {
        const globalSequences = Array.isArray(this.model?.GlobalSequences) ? this.model.GlobalSequences : [];
        const maxLen = Math.min(this.rendererData.globalSequencesFrames.length, globalSequences.length);

        for (let i = 0; i < maxLen; ++i) {
            this.rendererData.globalSequencesFrames[i] += delta;
            if (this.rendererData.globalSequencesFrames[i] > globalSequences[i]) {
                this.rendererData.globalSequencesFrames[i] = 0;
            }
        }

        if (this.rendererData.globalSequencesFrames.length > globalSequences.length) {
            this.rendererData.globalSequencesFrames.length = globalSequences.length;
        }
    }

    private updateNode(node: NodeWrapper): void {
        const pivot = (node.node.PivotPoint && (node.node.PivotPoint as any).length >= 3) ? node.node.PivotPoint as vec3 : defaultTranslation;
        const translationRes = this.interp.vec3(translation, node.node.Translation);
        const rotationRes = this.interp.quat(rotation, node.node.Rotation);
        const scalingRes = this.interp.vec3(scaling, node.node.Scaling);

        if (!translationRes && !rotationRes && !scalingRes) {
            mat4.identity(node.matrix);
        } else if (translationRes && !rotationRes && !scalingRes) {
            mat4.fromTranslation(node.matrix, translationRes);
        } else if (!translationRes && rotationRes && !scalingRes) {
            mat4.fromRotationTranslationScaleOrigin(node.matrix, rotationRes, defaultTranslation, defaultScaling, pivot);
        } else {
            mat4.fromRotationTranslationScaleOrigin(node.matrix,
                rotationRes || defaultRotation,
                translationRes || defaultTranslation,
                scalingRes || defaultScaling,
                pivot
            );
        }

        // NaN check: If any matrix value is NaN, reset to identity to prevent mesh explosion
        // This can happen when animation keys don't cover the current frame range
        if (isNaN(node.matrix[0]) || isNaN(node.matrix[12])) {
            console.warn('[ModelInstance] NaN detected in bone matrix for:', node.node.Name, 'resetting to identity');
            mat4.identity(node.matrix);
        }

        // Multiply by parent matrix if parent exists
        // BUG FIX: Check that parent node actually exists in rendererData.nodes before accessing
        const parentIndex = node.node.Parent;
        const parentNode = (parentIndex !== undefined && parentIndex !== null && parentIndex >= 0) ? this.rendererData.nodes[parentIndex] : null;
        if (parentNode) {
            mat4.mul(node.matrix, parentNode.matrix, node.matrix);
        } else if (typeof parentIndex === 'number' && parentIndex >= 0) {
            // Parent index is a valid positive number but parent node not found - this is a bug!
            if (!this._missingParentLogged) {
                this._missingParentLogged = new Set();
            }
            if (!this._missingParentLogged.has(node.node.ObjectId)) {
                this._missingParentLogged.add(node.node.ObjectId);
                console.warn('[ModelInstance] Parent node not found! Node:', node.node.Name, 'ObjectId:', node.node.ObjectId, 'seeks Parent:', parentIndex);
            }
        }
        // Note: parentIndex === null, undefined, or -1 means root node - no warning needed

        const billboardedLock = node.node.Flags & NodeFlags.BillboardedLockX ||
            node.node.Flags & NodeFlags.BillboardedLockY ||
            node.node.Flags & NodeFlags.BillboardedLockZ;

        if (node.node.Flags & NodeFlags.Billboarded) {
            vec3.transformMat4(tempTransformedPivotPoint, pivot, node.matrix);

            if (parentNode) {
                // cancel parent rotation from PivotPoint
                mat4.getRotation(tempParentRotationQuat, parentNode.matrix);
                quat.invert(tempParentRotationQuat, tempParentRotationQuat);
                mat4.fromRotationTranslationScaleOrigin(tempParentRotationMat, tempParentRotationQuat, defaultTranslation, defaultScaling,
                    tempTransformedPivotPoint);
                mat4.mul(node.matrix, tempParentRotationMat, node.matrix);
            }

            // rotate to camera with coordinate basis conversion
            // MDX models require Y(-90°) then X(-90°) rotation for correct billboard orientation
            // Reference: mdx-m3-viewer/src/viewer/handlers/mdx/node.ts convertBasis()
            quat.copy(tempLockQuat, this.rendererData.cameraQuat);
            quat.rotateY(tempLockQuat, tempLockQuat, -Math.PI / 2);
            quat.rotateX(tempLockQuat, tempLockQuat, -Math.PI / 2);
            mat4.fromRotationTranslationScaleOrigin(tempCameraMat, tempLockQuat, defaultTranslation, defaultScaling, tempTransformedPivotPoint);
            mat4.mul(node.matrix, tempCameraMat, node.matrix);
        } else if (billboardedLock) {
            vec3.transformMat4(tempTransformedPivotPoint, pivot, node.matrix);
            vec3.copy(tempAxis, pivot);

            // todo BillboardedLockX ?
            if (node.node.Flags & NodeFlags.BillboardedLockX) {
                tempAxis[0] += 1;
            } else if (node.node.Flags & NodeFlags.BillboardedLockY) {
                tempAxis[1] += 1;
            } else if (node.node.Flags & NodeFlags.BillboardedLockZ) {
                tempAxis[2] += 1;
            }

            vec3.transformMat4(tempAxis, tempAxis, node.matrix);
            vec3.sub(tempAxis, tempAxis, tempTransformedPivotPoint);

            vec3.set(tempXAxis, 1, 0, 0);
            vec3.add(tempXAxis, tempXAxis, pivot);
            vec3.transformMat4(tempXAxis, tempXAxis, node.matrix);
            vec3.sub(tempXAxis, tempXAxis, tempTransformedPivotPoint);

            vec3.set(tempCameraVec, -1, 0, 0);
            vec3.transformQuat(tempCameraVec, tempCameraVec, this.rendererData.cameraQuat);

            vec3.cross(tempCross0, tempAxis, tempCameraVec);
            vec3.cross(tempCross1, tempAxis, tempCross0);

            vec3.normalize(tempCross1, tempCross1);

            quat.rotationTo(tempLockQuat, tempXAxis, tempCross1);
            mat4.fromRotationTranslationScaleOrigin(tempLockMat, tempLockQuat, defaultTranslation, defaultScaling, tempTransformedPivotPoint);
            mat4.mul(node.matrix, tempLockMat, node.matrix);
        }

        for (const child of node.childs) {
            this.updateNode(child);
        }
    }

    public findAlpha(geosetId: number): number {
        const geosetAnim = this.rendererData.geosetAnims[geosetId];

        if (!geosetAnim || geosetAnim.Alpha === undefined) {
            return 1;
        }

        if (typeof geosetAnim.Alpha === 'number') {
            return geosetAnim.Alpha;
        }

        const interpRes = this.interp.num(geosetAnim.Alpha);

        if (interpRes === null) {
            return 1;
        }
        return interpRes;
    }

    public findColor(geosetId: number): Float32Array {
        if (!this.enableGeosetAnimColor) {
            tempColorResult[0] = 1; tempColorResult[1] = 1; tempColorResult[2] = 1;
            return tempColorResult;
        }

        const geosetAnim = this.rendererData.geosetAnims[geosetId];

        if (!geosetAnim || geosetAnim.Color === undefined) {
            tempColorResult[0] = 1; tempColorResult[1] = 1; tempColorResult[2] = 1;
            return tempColorResult;
        }

        if (geosetAnim.Color instanceof Float32Array) {
            tempColorResult[0] = geosetAnim.Color[0];
            tempColorResult[1] = geosetAnim.Color[1];
            tempColorResult[2] = geosetAnim.Color[2];
            return tempColorResult;
        }

        const interpRes = this.interp.vec3(tempVec3, geosetAnim.Color as AnimVector);

        if (interpRes === null) {
            tempColorResult[0] = 1; tempColorResult[1] = 1; tempColorResult[2] = 1;
            return tempColorResult;
        }
        tempColorResult[0] = interpRes[0];
        tempColorResult[1] = interpRes[1];
        tempColorResult[2] = interpRes[2];
        return tempColorResult;
    }

    public getTexCoordMatrix(layer: Layer): mat3 {
        if (typeof layer.TVertexAnimId === 'number') {
            // Safety check: ensure TextureAnims exists and has the requested index
            if (!this.rendererData.model.TextureAnims ||
                layer.TVertexAnimId >= this.rendererData.model.TextureAnims.length) {
                // Debug: log when TextureAnims is missing or index out of bounds
                // console.log('[getTexCoordMatrix] TextureAnims missing or index out of bounds:', layer.TVertexAnimId, 'length:', this.rendererData.model.TextureAnims?.length);
                return identifyMat3;
            }
            const anim: TVertexAnim = this.rendererData.model.TextureAnims[layer.TVertexAnimId];
            if (!anim) {
                // console.log('[getTexCoordMatrix] Anim is null/undefined at index:', layer.TVertexAnimId);
                return identifyMat3;
            }
            const translationRes = this.interp.vec3(translation, anim.Translation);
            const rotationRes = this.interp.quat(rotation, anim.Rotation);
            const scalingRes = this.interp.vec3(scaling, anim.Scaling);

            // Debug: log when any interpolation returns a result (animation is active)
            if (translationRes || rotationRes || scalingRes) {
                // Uncomment for debug:
                // console.log('[getTexCoordMatrix] Animation active! TVertexAnimId:', layer.TVertexAnimId, 'trans:', translationRes, 'rot:', rotationRes, 'scale:', scalingRes);
            }

            mat4.fromRotationTranslationScale(
                texCoordMat4,
                rotationRes || defaultRotation,
                translationRes || defaultTranslation,
                scalingRes || defaultScaling
            );
            mat3.set(
                texCoordMat3,
                texCoordMat4[0], texCoordMat4[1], 0,
                texCoordMat4[4], texCoordMat4[5], 0,
                texCoordMat4[12], texCoordMat4[13], 0
            );

            return texCoordMat3;
        } else {
            return identifyMat3;
        }
    }

    // ==================== LIGHT NODE SUPPORT ====================

    /**
     * Get computed properties for a Light node at the current animation frame.
     * This is used for DNC (Day/Night Cycle) environmental lighting.
     */
    public getLightProps(light: Light): {
        direction: vec3;
        color: vec3;
        intensity: number;
        ambientColor: vec3;
        ambientIntensity: number;
        visibility: number;
        type: LightType;
        attenuationStart: number;
        attenuationEnd: number;
    } {
        const nodeWrapper = this.rendererData.nodes[light.ObjectId];

        // Calculate direction from node's rotation (for Directional lights)
        const direction = tempLightDirection;
        const baseDir = tempBaseDir;

        // First, try to get rotation from the Light node's Rotation property directly
        // This is more reliable for DNC models with GlobalSequence duration 0
        const rotationQuat = tempLightRotationQuat;
        let hasValidRotation = false;

        if (light.Rotation) {
            // Try to get rotation from animation
            const interpRot = this.interp.quat(rotationQuat, light.Rotation);
            if (interpRot) {
                hasValidRotation = true;
            } else {
                // Fallback: use the first keyframe directly if available
                const animVec = light.Rotation as AnimVector;
                if (animVec.Keys && animVec.Keys.length > 0) {
                    const firstKey = animVec.Keys[0].Vector;
                    if (firstKey && firstKey.length >= 4) {
                        quat.set(rotationQuat, firstKey[0], firstKey[1], firstKey[2], firstKey[3]);
                        hasValidRotation = true;
                    }
                }
            }
        }

        if (hasValidRotation) {
            // Transform base direction by the rotation quaternion
            vec3.transformQuat(direction, baseDir, rotationQuat);
            vec3.normalize(direction, direction);
        } else if (nodeWrapper && nodeWrapper.matrix) {
            // Fallback to node's world matrix
            mat3.fromMat4(tempLightRotationMat3, nodeWrapper.matrix);
            vec3.transformMat3(direction, baseDir, tempLightRotationMat3);
            vec3.normalize(direction, direction);
        } else {
            // Final fallback: default direction
            vec3.set(direction, 1, -1, 1);
            vec3.normalize(direction, direction);
        }

        // Calculate color (RGB)
        const color = tempLightColor;

        if (light.Color) {
            if (light.Color instanceof Float32Array) {
                vec3.copy(color, light.Color as vec3);
            } else if (Array.isArray(light.Color)) {
                // Handle regular JavaScript arrays (e.g., from UI edits)
                vec3.set(color, light.Color[0], light.Color[1], light.Color[2]);
            } else {
                // AnimVector - interpolate
                const interpColor = this.interp.vec3(color, light.Color as AnimVector);
                if (!interpColor) {
                    vec3.set(color, 1, 1, 1); // Default white if no keyframes
                }
            }
        } else {
            vec3.set(color, 1, 1, 1);
        }

        // Calculate intensity
        let intensity = 1.0;
        if (light.Intensity !== undefined) {
            intensity = this.interp.animVectorVal(light.Intensity, 1.0);
        }

        // Calculate ambient color
        const ambientColor = tempLightAmbientColor;
        if (light.AmbColor) {
            if (light.AmbColor instanceof Float32Array) {
                vec3.copy(ambientColor, light.AmbColor as vec3);
            } else {
                const interpAmbColor = this.interp.vec3(ambientColor, light.AmbColor as AnimVector);
                if (!interpAmbColor) {
                    vec3.set(ambientColor, 0.3, 0.3, 0.3); // Default dim ambient
                }
            }
        } else {
            vec3.set(ambientColor, 0.3, 0.3, 0.3);
        }

        // Calculate ambient intensity
        let ambientIntensity = 1.0;
        if (light.AmbIntensity !== undefined) {
            ambientIntensity = this.interp.animVectorVal(light.AmbIntensity, 1.0);
        }

        // Calculate visibility
        let visibility = 1.0;
        if (light.Visibility) {
            const interpVis = this.interp.num(light.Visibility);
            if (interpVis !== null) {
                visibility = interpVis;
            }
        }

        // Calculate attenuation
        let attenuationStart = 80;
        if (light.AttenuationStart !== undefined) {
            attenuationStart = this.interp.animVectorVal(light.AttenuationStart, 80);
        }

        let attenuationEnd = 200;
        if (light.AttenuationEnd !== undefined) {
            attenuationEnd = this.interp.animVectorVal(light.AttenuationEnd, 200);
        }

        return {
            direction: vec3.clone(direction),
            color: vec3.clone(color),
            intensity,
            ambientColor: vec3.clone(ambientColor),
            ambientIntensity,
            visibility,
            type: light.LightType,
            attenuationStart,
            attenuationEnd
        };

    }

    /**
     * Find the primary directional light in the model.
     * DNC models typically have one main Directional light for the sun.
     */
    public findPrimaryDirectionalLight(): Light | null {
        if (!this.model.Lights || this.model.Lights.length === 0) {
            return null;
        }

        // First, try to find a Directional light
        for (const light of this.model.Lights) {
            if (light.LightType === LightType.Directional) {
                return light;
            }
        }

        // Fallback: return the first light
        return this.model.Lights[0];
    }

    /**
     * Get accumulated light contribution from all lights in the model.
     * This combines all visible lights' colors and intensities.
     */
    public getAccumulatedLightParams(): {
        lightColor: vec3;
        ambientColor: vec3;
        lightDirection: vec3;
    } {
        const lightColor = vec3.fromValues(0, 0, 0);
        const ambientColor = vec3.fromValues(0, 0, 0);
        const lightDirection = vec3.fromValues(1, -1, 1); // Default diagonal direction
        vec3.normalize(lightDirection, lightDirection);
        let hasDirectional = false;
        let hasAnyLight = false;

        if (!this.model.Lights || this.model.Lights.length === 0) {
            // Return defaults if no lights
            vec3.set(lightColor, 1, 1, 1);
            vec3.set(ambientColor, 0.3, 0.3, 0.3);
            return { lightColor, ambientColor, lightDirection };
        }

        for (const light of this.model.Lights) {
            const props = this.getLightProps(light);

            // Skip invisible lights
            if (props.visibility < 0.01) continue;

            // Check for NaN values and skip if found
            if (isNaN(props.intensity) || isNaN(props.ambientIntensity)) {
                console.warn('[ModelInstance] Light has NaN intensity, using defaults');
                continue;
            }

            hasAnyLight = true;

            // Accumulate light color (scaled by intensity and visibility)
            const scaledColor = tempScaledColor;
            vec3.scale(scaledColor, props.color, props.intensity * props.visibility);
            vec3.add(lightColor, lightColor, scaledColor);

            // Accumulate ambient color (scaled by ambient intensity and visibility)
            const scaledAmbient = tempScaledAmbient;
            vec3.scale(scaledAmbient, props.ambientColor, props.ambientIntensity * props.visibility);
            vec3.add(ambientColor, ambientColor, scaledAmbient);


            // Use the first visible directional light's direction
            if (props.type === LightType.Directional && !hasDirectional) {
                vec3.copy(lightDirection, props.direction);
                hasDirectional = true;
            }
        }

        // Fallback to defaults if no lights contributed
        if (!hasAnyLight || (lightColor[0] === 0 && lightColor[1] === 0 && lightColor[2] === 0)) {
            vec3.set(lightColor, 1, 1, 1);
        }
        if (ambientColor[0] === 0 && ambientColor[1] === 0 && ambientColor[2] === 0) {
            vec3.set(ambientColor, 0.3, 0.3, 0.3);
        }

        // Final NaN protection
        for (let i = 0; i < 3; i++) {
            if (isNaN(lightColor[i])) lightColor[i] = 1;
            if (isNaN(ambientColor[i])) ambientColor[i] = 0.3;
            if (isNaN(lightDirection[i])) lightDirection[i] = i === 1 ? -1 : 1;
        }

        return { lightColor, ambientColor, lightDirection };
    }
    public collectActiveLights(): LightResult[] {
        const activeLights: LightResult[] = [];

        if (!this.model.Lights || this.model.Lights.length === 0) {
            return activeLights;
        }

        for (const light of this.model.Lights) {
            const props = this.getLightProps(light);

            // Skip invisible or very low intensity lights
            if (props.visibility < 0.01 || props.intensity < 0.001) continue;

            // Get World Position from Node
            const nodeWrapper = this.rendererData.nodes[light.ObjectId];
            const worldPosition = vec3.create();

            if (nodeWrapper && nodeWrapper.matrix) {
                mat4.getTranslation(worldPosition, nodeWrapper.matrix);
                // nodeWrapper.matrix is Model Local (relative to model origin).
                // We must apply the instance's World Matrix to get the true Global World Position.
                vec3.transformMat4(worldPosition, worldPosition, this.worldMatrix);
            } else {
                // Fallback for root-level or unparented lights
                if (light.PivotPoint) {
                    vec3.copy(worldPosition, light.PivotPoint as vec3);
                    vec3.transformMat4(worldPosition, worldPosition, this.worldMatrix);
                }
            }

            // Direction is already calculated in getLightProps (based on rotation)
            // But getLightProps returns it in "Model Space" relative to node rotation.
            // We need World Space Direction. 

            const worldDirection = vec3.create();
            // Recalculate direction using World Matrix
            const baseDir = vec3.fromValues(0, 0, -1); // Standard directional light direction in local space? or based on type?
            // MDX Lights: Directional lights point down Z usually? Or X? 
            // In getLightProps, we usually get rotation.

            if (nodeWrapper && nodeWrapper.matrix) {
                const rotationMat = mat3.create();
                mat3.fromMat4(rotationMat, nodeWrapper.matrix);

                // Rotate base direction by Node Rotation
                vec3.transformMat3(worldDirection, baseDir, rotationMat);

                // Then Rotate by Instance World Rotation
                const instanceNormalMat = mat3.create();
                mat3.fromMat4(instanceNormalMat, this.worldMatrix);
                vec3.transformMat3(worldDirection, worldDirection, instanceNormalMat);

                vec3.normalize(worldDirection, worldDirection);
            } else {
                vec3.copy(worldDirection, props.direction);
                // Fallback transform
                const instanceNormalMat = mat3.create();
                mat3.fromMat4(instanceNormalMat, this.worldMatrix);
                vec3.transformMat3(worldDirection, worldDirection, instanceNormalMat);
                vec3.normalize(worldDirection, worldDirection);
            }

            // Calculate Attenuation Coefficients based on Start/End
            // Formula: 1.0 / (C + L*d + Q*d^2)
            // Map MDX (End-Dist)/(End-Start) to standard.
            // Simplified approximation:
            // At Start, Atten ~= 1. At End, Atten ~= 0.
            // Using logic: Start is where falloff begins (Intensity max), End is where it hits 0.
            // We can set C=1 (max intensity), and solve for L and Q.
            // For now, let's use:
            // Constant = 1.0 (Assume normalized intensity at source)
            // Linear = 4.5 / End (Simply scaling falloff to hit ~0 at End)
            // Quadratic = 75.0 / (End^2) (Aggressive falloff)
            // This is tuning.

            const attenEnd = Math.max(0.001, props.attenuationEnd); // Avoid div zero
            const C = 1.0;
            const L = 2.0 / attenEnd;
            const Q = 10.0 / (attenEnd * attenEnd);

            activeLights.push({
                type: props.type,
                position: worldPosition,
                direction: worldDirection,
                color: props.color,
                intensity: props.intensity,
                attenuation: vec3.fromValues(C, L, Q),
                attenuationStart: props.attenuationStart,
                attenuationEnd: props.attenuationEnd
            });
        }

        return activeLights;
    }
}



