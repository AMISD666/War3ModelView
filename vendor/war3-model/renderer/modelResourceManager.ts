import { Model } from '../model';

export interface ModelBuffers {
    vertexBuffer: WebGLBuffer[];
    normalBuffer: WebGLBuffer[];
    texCoordBuffer: WebGLBuffer[];
    skinWeightBuffer: WebGLBuffer[];
    tangentBuffer: WebGLBuffer[];
    groupBuffer: WebGLBuffer[];
    indexBuffer: WebGLBuffer[];
    wireframeIndexBuffer: WebGLBuffer[];
}

export interface ModelGPUBuffers {
    vertexBuffer: GPUBuffer[];
    normalBuffer: GPUBuffer[];
    texCoordBuffer: GPUBuffer[];
    skinWeightBuffer: GPUBuffer[];
    tangentBuffer: GPUBuffer[];
    groupBuffer: GPUBuffer[];
    indexBuffer: GPUBuffer[];
    wireframeIndexBuffer: GPUBuffer[];
}

export class ModelResourceManager {
    private static instance: ModelResourceManager;

    private gl: WebGL2RenderingContext | WebGLRenderingContext | null = null;
    private device: GPUDevice | null = null;

    private buffers: Map<Model, ModelBuffers> = new Map();
    private gpuBuffers: Map<Model, ModelGPUBuffers> = new Map();

    private textures: Map<string, WebGLTexture> = new Map();
    private gpuTextures: Map<string, GPUTexture> = new Map();

    private constructor() { }

    public static getInstance(): ModelResourceManager {
        if (!ModelResourceManager.instance) {
            ModelResourceManager.instance = new ModelResourceManager();
        }
        return ModelResourceManager.instance;
    }

    public initGL(gl: WebGL2RenderingContext | WebGLRenderingContext) {
        // WebGLTexture objects are context-bound.
        // Reusing textures created by a previous context causes:
        // INVALID_OPERATION: bindTexture: object does not belong to this context
        if (this.gl && this.gl !== gl) {
            this.textures.clear();
            this.buffers.clear();
        }
        this.gl = gl;
    }

    public initDevice(device: GPUDevice) {
        // GPUTexture/GPUBuffer are device-bound; never reuse across devices.
        if (this.device && this.device !== device) {
            this.gpuTextures.clear();
            this.gpuBuffers.clear();
        }
        this.device = device;
    }

    public getBuffers(model: Model, softwareSkinning: boolean): ModelBuffers | null {
        if (!this.gl) return null;

        if (!this.buffers.has(model)) {
            this.initBuffers(model, softwareSkinning);
        }
        return this.buffers.get(model) || null;
    }

    public getGPUBuffers(model: Model): ModelGPUBuffers | null {
        if (!this.device) return null;

        if (!this.gpuBuffers.has(model)) {
            this.initGPUBuffers(model);
        }
        return this.gpuBuffers.get(model) || null;
    }

    private initBuffers(model: Model, softwareSkinning: boolean) {
        if (!this.gl) return;
        const gl = this.gl;
        const geosets = Array.isArray(model?.Geosets) ? model.Geosets : [];
        const isHD = geosets.some(it => (it?.SkinWeights?.length ?? 0) > 0);
        const BONE_SENTINEL = 65535; // Sentinel value for "no bone" - must match shader expectation

        const buffers: ModelBuffers = {
            vertexBuffer: [],
            normalBuffer: [],
            texCoordBuffer: [],
            skinWeightBuffer: [],
            tangentBuffer: [],
            groupBuffer: [],
            indexBuffer: [],
            wireframeIndexBuffer: []
        };

        if (geosets.length === 0) {
            this.buffers.set(model, buffers);
            return;
        }

        for (let i = 0; i < geosets.length; ++i) {
            const geoset = geosets[i];

            buffers.vertexBuffer[i] = gl.createBuffer()!;
            gl.bindBuffer(gl.ARRAY_BUFFER, buffers.vertexBuffer[i]);
            gl.bufferData(gl.ARRAY_BUFFER, geoset.Vertices, gl.STATIC_DRAW);

            buffers.normalBuffer[i] = gl.createBuffer()!;
            gl.bindBuffer(gl.ARRAY_BUFFER, buffers.normalBuffer[i]);
            gl.bufferData(gl.ARRAY_BUFFER, geoset.Normals, gl.STATIC_DRAW);

            buffers.texCoordBuffer[i] = gl.createBuffer()!;
            gl.bindBuffer(gl.ARRAY_BUFFER, buffers.texCoordBuffer[i]);
            gl.bufferData(gl.ARRAY_BUFFER, geoset.TVertices[0], gl.STATIC_DRAW);

            if (isHD && geoset.SkinWeights && geoset.Tangents) {
                buffers.skinWeightBuffer[i] = gl.createBuffer()!;
                gl.bindBuffer(gl.ARRAY_BUFFER, buffers.skinWeightBuffer[i]);
                gl.bufferData(gl.ARRAY_BUFFER, geoset.SkinWeights, gl.STATIC_DRAW);

                buffers.tangentBuffer[i] = gl.createBuffer()!;
                gl.bindBuffer(gl.ARRAY_BUFFER, buffers.tangentBuffer[i]);
                gl.bufferData(gl.ARRAY_BUFFER, geoset.Tangents, gl.STATIC_DRAW);
            } else {
                if (!softwareSkinning) {
                    buffers.groupBuffer[i] = gl.createBuffer()!;
                    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.groupBuffer[i]);
                    const buffer = new Uint16Array(geoset.VertexGroup.length * 4);
                    for (let j = 0; j < buffer.length; j += 4) {
                        const index = j / 4;
                        const group = geoset.Groups[geoset.VertexGroup[index]];
                        // Groups contains ObjectIds directly from MDX file
                        buffer[j] = group[0];
                        buffer[j + 1] = group.length > 1 ? group[1] : BONE_SENTINEL;
                        buffer[j + 2] = group.length > 2 ? group[2] : BONE_SENTINEL;
                        buffer[j + 3] = group.length > 3 ? group[3] : BONE_SENTINEL;
                    }
                    gl.bufferData(gl.ARRAY_BUFFER, buffer, gl.STATIC_DRAW);
                }
            }

            buffers.indexBuffer[i] = gl.createBuffer()!;
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.indexBuffer[i]);
            gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geoset.Faces, gl.STATIC_DRAW);
        }


        this.buffers.set(model, buffers);
    }

    private initGPUBuffers(model: Model) {
        if (!this.device) return;
        const device = this.device;
        const geosets = Array.isArray(model?.Geosets) ? model.Geosets : [];
        const isHD = geosets.some(it => (it?.SkinWeights?.length ?? 0) > 0);
        const BONE_SENTINEL = 65535; // Sentinel value for "no bone" - must match shader expectation


        const buffers: ModelGPUBuffers = {
            vertexBuffer: [],
            normalBuffer: [],
            texCoordBuffer: [],
            skinWeightBuffer: [],
            tangentBuffer: [],
            groupBuffer: [],
            indexBuffer: [],
            wireframeIndexBuffer: []
        };

        if (geosets.length === 0) {
            this.gpuBuffers.set(model, buffers);
            return;
        }

        for (let i = 0; i < geosets.length; ++i) {
            const geoset = geosets[i];

            buffers.vertexBuffer[i] = device.createBuffer({
                label: `vertex ${i}`,
                size: geoset.Vertices.byteLength,
                usage: GPUBufferUsage.VERTEX,
                mappedAtCreation: true
            });
            new Float32Array(buffers.vertexBuffer[i].getMappedRange()).set(geoset.Vertices);
            buffers.vertexBuffer[i].unmap();

            buffers.normalBuffer[i] = device.createBuffer({
                label: `normal ${i}`,
                size: geoset.Normals.byteLength,
                usage: GPUBufferUsage.VERTEX,
                mappedAtCreation: true
            });
            new Float32Array(buffers.normalBuffer[i].getMappedRange()).set(geoset.Normals);
            buffers.normalBuffer[i].unmap();

            buffers.texCoordBuffer[i] = device.createBuffer({
                label: `texCoord ${i}`,
                size: geoset.TVertices[0].byteLength,
                usage: GPUBufferUsage.VERTEX,
                mappedAtCreation: true
            });
            new Float32Array(buffers.texCoordBuffer[i].getMappedRange()).set(geoset.TVertices[0]);
            buffers.texCoordBuffer[i].unmap();

            if (isHD && geoset.SkinWeights && geoset.Tangents) {
                buffers.skinWeightBuffer[i] = device.createBuffer({
                    label: `SkinWeight ${i}`,
                    size: geoset.SkinWeights.byteLength,
                    usage: GPUBufferUsage.VERTEX,
                    mappedAtCreation: true
                });
                new Uint8Array(buffers.skinWeightBuffer[i].getMappedRange()).set(geoset.SkinWeights);
                buffers.skinWeightBuffer[i].unmap();

                buffers.tangentBuffer[i] = device.createBuffer({
                    label: `Tangents ${i}`,
                    size: geoset.Tangents.byteLength,
                    usage: GPUBufferUsage.VERTEX,
                    mappedAtCreation: true
                });
                new Float32Array(buffers.tangentBuffer[i].getMappedRange()).set(geoset.Tangents);
                buffers.tangentBuffer[i].unmap();
            } else {
                // IMPORTANT: groups are u16 in the MDX pipeline (WebGL uses UNSIGNED_SHORT and sentinel 65535).
                // Using u8 here truncates bone indices and breaks the 65535 sentinel check in WGSL.
                const buffer = new Uint16Array(geoset.VertexGroup.length * 4);
                for (let j = 0; j < buffer.length; j += 4) {
                    const index = j / 4;
                    const groupIndex = geoset.VertexGroup[index];
                    const group = geoset.Groups && geoset.Groups[groupIndex] ? geoset.Groups[groupIndex] : [0];
                    // Groups contains ObjectIds directly from MDX file
                    buffer[j] = group[0] ?? 0;
                    buffer[j + 1] = group.length > 1 ? group[1] : BONE_SENTINEL;
                    buffer[j + 2] = group.length > 2 ? group[2] : BONE_SENTINEL;
                    buffer[j + 3] = group.length > 3 ? group[3] : BONE_SENTINEL;
                }
                buffers.groupBuffer[i] = device.createBuffer({
                    label: `group ${i}`,
                    size: buffer.byteLength,
                    usage: GPUBufferUsage.VERTEX,
                    mappedAtCreation: true
                });
                new Uint16Array(buffers.groupBuffer[i].getMappedRange()).set(buffer);
                buffers.groupBuffer[i].unmap();
            }

            const size = Math.ceil(geoset.Faces.byteLength / 4) * 4;
            buffers.indexBuffer[i] = device.createBuffer({
                label: `index ${i}`,
                size: 2 * size,
                usage: GPUBufferUsage.INDEX,
                mappedAtCreation: true
            });
            new Uint16Array(buffers.indexBuffer[i].getMappedRange(0, size)).set(geoset.Faces);
            buffers.indexBuffer[i].unmap();
        }

        this.gpuBuffers.set(model, buffers);
    }

    public getTexture(path: string): WebGLTexture | undefined {
        return this.textures.get(path);
    }

    public setTexture(path: string, texture: WebGLTexture) {
        this.textures.set(path, texture);
    }

    /**
     * Delete a WebGL texture from GPU memory and remove it from the cache.
     * Must be called when no models are using a texture to prevent GPU VRAM exhaustion.
     */
    public removeTexture(path: string): void {
        const texture = this.textures.get(path);
        if (texture && this.gl) {
            this.gl.deleteTexture(texture);
        }
        this.textures.delete(path);

        const gpuTexture = this.gpuTextures.get(path);
        if (gpuTexture) {
            gpuTexture.destroy();
        }
        this.gpuTextures.delete(path);
    }

    public getGPUTexture(path: string): GPUTexture | undefined {
        return this.gpuTextures.get(path);
    }

    public setGPUTexture(path: string, texture: GPUTexture) {
        this.gpuTextures.set(path, texture);
    }

    /**
     * Update texture coordinates buffer for a specific geoset.
     * This enables real-time UV editing in the 3D viewer.
     */
    public updateGeosetTexCoords(model: Model, geosetIndex: number, newTVertices: Float32Array): void {
        // ... implementation existing ...
        // (Keeping existing code short for diff context, actually replacing the method)
        if (this.gl && this.buffers.has(model)) {
            const buffers = this.buffers.get(model)!;
            if (buffers.texCoordBuffer[geosetIndex]) {
                const gl = this.gl;
                gl.bindBuffer(gl.ARRAY_BUFFER, buffers.texCoordBuffer[geosetIndex]);
                gl.bufferSubData(gl.ARRAY_BUFFER, 0, newTVertices);
                gl.bindBuffer(gl.ARRAY_BUFFER, null);
            }
        }

        if (this.device && this.gpuBuffers.has(model)) {
            const buffers = this.gpuBuffers.get(model)!;
            if (buffers.texCoordBuffer[geosetIndex]) {
                buffers.texCoordBuffer[geosetIndex].destroy();
            }
            buffers.texCoordBuffer[geosetIndex] = this.device.createBuffer({
                label: `texCoord ${geosetIndex} (updated)`,
                size: newTVertices.byteLength,
                usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
                mappedAtCreation: true
            });
            new Float32Array(buffers.texCoordBuffer[geosetIndex].getMappedRange()).set(newTVertices);
            buffers.texCoordBuffer[geosetIndex].unmap();
        }
    }

    public updateGeosetGroups(model: Model, geosetIndex: number): void {
        const geoset = model.Geosets[geosetIndex];
        if (!geoset) return;
        const BONE_SENTINEL = 65535;

        // WebGL
        if (this.gl && this.buffers.has(model)) {
            const gl = this.gl;
            const buffers = this.buffers.get(model)!;

            if (buffers.groupBuffer[geosetIndex]) {
                gl.bindBuffer(gl.ARRAY_BUFFER, buffers.groupBuffer[geosetIndex]);
                const buffer = new Uint16Array(geoset.VertexGroup.length * 4);
                for (let j = 0; j < buffer.length; j += 4) {
                    const index = j / 4;
                    const groupIndex = geoset.VertexGroup[index];
                    const group = geoset.Groups && geoset.Groups[groupIndex] ? geoset.Groups[groupIndex] : [0];
                    // Groups contains ObjectIds directly from MDX file
                    buffer[j] = group[0] ?? 0;
                    buffer[j + 1] = group.length > 1 ? group[1] : BONE_SENTINEL;
                    buffer[j + 2] = group.length > 2 ? group[2] : BONE_SENTINEL;
                    buffer[j + 3] = group.length > 3 ? group[3] : BONE_SENTINEL;
                }
                gl.bufferData(gl.ARRAY_BUFFER, buffer, gl.STATIC_DRAW);
                gl.bindBuffer(gl.ARRAY_BUFFER, null);
            }
        }

        // WebGPU
        if (this.device && this.gpuBuffers.has(model)) {
            const device = this.device;
            const buffers = this.gpuBuffers.get(model)!;

            if (buffers.groupBuffer[geosetIndex]) {
                buffers.groupBuffer[geosetIndex].destroy();
            }

            // Reusing logic from initGPUBuffers (Switched to Uint16Array to match WebGL and avoid BoneID truncation)
            const buffer = new Uint16Array(geoset.VertexGroup.length * 4);
            for (let j = 0; j < buffer.length; j += 4) {
                const index = j / 4;
                const groupIndex = geoset.VertexGroup[index];
                const group = geoset.Groups && geoset.Groups[groupIndex] ? geoset.Groups[groupIndex] : [0];
                // Groups contains ObjectIds directly from MDX file
                buffer[j] = group[0] ?? 0;
                buffer[j + 1] = group.length > 1 ? group[1] : BONE_SENTINEL;
                buffer[j + 2] = group.length > 2 ? group[2] : BONE_SENTINEL;
                buffer[j + 3] = group.length > 3 ? group[3] : BONE_SENTINEL;
            }

            buffers.groupBuffer[geosetIndex] = device.createBuffer({
                label: `group ${geosetIndex} (updated)`,
                size: buffer.byteLength,
                usage: GPUBufferUsage.VERTEX,
                mappedAtCreation: true
            });
            new Uint16Array(buffers.groupBuffer[geosetIndex].getMappedRange()).set(buffer);
            buffers.groupBuffer[geosetIndex].unmap();
        }
    }

    /**
     * Add GPU buffers for a dynamically added geoset.
     * This enables Split/Paste operations to create new geosets that can be rendered.
     * @param model - The model containing the new geoset
     * @param geosetIndex - Index of the newly added geoset
     */
    public addGeosetBuffers(model: Model, geosetIndex: number): void {
        const geoset = model.Geosets[geosetIndex];
        if (!geoset) {
            console.error('[ModelResourceManager] addGeosetBuffers: Invalid geoset index', geosetIndex);
            return;
        }

        console.log('[ModelResourceManager] Adding buffers for geoset', geosetIndex, {
            vertices: geoset.Vertices?.length / 3,
            faces: geoset.Faces?.length / 3,
            normals: geoset.Normals?.length / 3
        });

        // Create WebGL buffers
        if (this.gl && this.buffers.has(model)) {
            const gl = this.gl;
            const buffers = this.buffers.get(model)!;
            const isHD = model.Geosets?.some(it => (it.SkinWeights?.length ?? 0) > 0);
            const BONE_SENTINEL = 65535;

            // Vertex buffer
            buffers.vertexBuffer[geosetIndex] = gl.createBuffer()!;
            gl.bindBuffer(gl.ARRAY_BUFFER, buffers.vertexBuffer[geosetIndex]);
            gl.bufferData(gl.ARRAY_BUFFER, geoset.Vertices, gl.STATIC_DRAW);

            // Normal buffer
            buffers.normalBuffer[geosetIndex] = gl.createBuffer()!;
            gl.bindBuffer(gl.ARRAY_BUFFER, buffers.normalBuffer[geosetIndex]);
            gl.bufferData(gl.ARRAY_BUFFER, geoset.Normals, gl.STATIC_DRAW);

            // Texture coordinate buffer
            buffers.texCoordBuffer[geosetIndex] = gl.createBuffer()!;
            gl.bindBuffer(gl.ARRAY_BUFFER, buffers.texCoordBuffer[geosetIndex]);
            if (geoset.TVertices && geoset.TVertices[0]) {
                gl.bufferData(gl.ARRAY_BUFFER, geoset.TVertices[0], gl.STATIC_DRAW);
            } else {
                // Create empty UV buffer if TVertices not available
                const emptyUV = new Float32Array(geoset.Vertices.length / 3 * 2);
                gl.bufferData(gl.ARRAY_BUFFER, emptyUV, gl.STATIC_DRAW);
            }

            if (isHD) {
                // HD model buffers
                if (geoset.SkinWeights) {
                    buffers.skinWeightBuffer[geosetIndex] = gl.createBuffer()!;
                    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.skinWeightBuffer[geosetIndex]);
                    gl.bufferData(gl.ARRAY_BUFFER, geoset.SkinWeights, gl.STATIC_DRAW);
                }
                if (geoset.Tangents) {
                    buffers.tangentBuffer[geosetIndex] = gl.createBuffer()!;
                    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.tangentBuffer[geosetIndex]);
                    gl.bufferData(gl.ARRAY_BUFFER, geoset.Tangents, gl.STATIC_DRAW);
                }
            } else {
                // SD model bone group buffer
                buffers.groupBuffer[geosetIndex] = gl.createBuffer()!;
                gl.bindBuffer(gl.ARRAY_BUFFER, buffers.groupBuffer[geosetIndex]);
                const buffer = new Uint16Array(geoset.VertexGroup.length * 4);
                for (let j = 0; j < buffer.length; j += 4) {
                    const index = j / 4;
                    const groupIndex = geoset.VertexGroup[index];
                    const group = geoset.Groups && geoset.Groups[groupIndex] ? geoset.Groups[groupIndex] : [0];
                    // Groups contains ObjectIds directly from MDX file
                    buffer[j] = group[0] ?? 0;
                    buffer[j + 1] = group.length > 1 ? group[1] : BONE_SENTINEL;
                    buffer[j + 2] = group.length > 2 ? group[2] : BONE_SENTINEL;
                    buffer[j + 3] = group.length > 3 ? group[3] : BONE_SENTINEL;
                }
                gl.bufferData(gl.ARRAY_BUFFER, buffer, gl.STATIC_DRAW);
            }

            // Index buffer (faces)
            buffers.indexBuffer[geosetIndex] = gl.createBuffer()!;
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.indexBuffer[geosetIndex]);
            gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geoset.Faces, gl.STATIC_DRAW);

            // Unbind buffers
            gl.bindBuffer(gl.ARRAY_BUFFER, null);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);

            console.log('[ModelResourceManager] WebGL buffers created for geoset', geosetIndex);
        }

        // Create WebGPU buffers if device is available
        if (this.device && this.gpuBuffers.has(model)) {
            const device = this.device;
            const buffers = this.gpuBuffers.get(model)!;
            const isHD = model.Geosets?.some(it => (it.SkinWeights?.length ?? 0) > 0);
            const BONE_SENTINEL = 65535;

            // Vertex buffer
            buffers.vertexBuffer[geosetIndex] = device.createBuffer({
                label: `vertex ${geosetIndex}`,
                size: geoset.Vertices.byteLength,
                usage: GPUBufferUsage.VERTEX,
                mappedAtCreation: true
            });
            new Float32Array(buffers.vertexBuffer[geosetIndex].getMappedRange()).set(geoset.Vertices);
            buffers.vertexBuffer[geosetIndex].unmap();

            // Normal buffer
            buffers.normalBuffer[geosetIndex] = device.createBuffer({
                label: `normal ${geosetIndex}`,
                size: geoset.Normals.byteLength,
                usage: GPUBufferUsage.VERTEX,
                mappedAtCreation: true
            });
            new Float32Array(buffers.normalBuffer[geosetIndex].getMappedRange()).set(geoset.Normals);
            buffers.normalBuffer[geosetIndex].unmap();

            // Texture coordinate buffer
            const texCoordData = geoset.TVertices && geoset.TVertices[0]
                ? geoset.TVertices[0]
                : new Float32Array(geoset.Vertices.length / 3 * 2);
            buffers.texCoordBuffer[geosetIndex] = device.createBuffer({
                label: `texCoord ${geosetIndex}`,
                size: texCoordData.byteLength,
                usage: GPUBufferUsage.VERTEX,
                mappedAtCreation: true
            });
            new Float32Array(buffers.texCoordBuffer[geosetIndex].getMappedRange()).set(texCoordData);
            buffers.texCoordBuffer[geosetIndex].unmap();

            if (isHD) {
                if (geoset.SkinWeights) {
                    buffers.skinWeightBuffer[geosetIndex] = device.createBuffer({
                        label: `SkinWeight ${geosetIndex}`,
                        size: geoset.SkinWeights.byteLength,
                        usage: GPUBufferUsage.VERTEX,
                        mappedAtCreation: true
                    });
                    new Uint8Array(buffers.skinWeightBuffer[geosetIndex].getMappedRange()).set(geoset.SkinWeights);
                    buffers.skinWeightBuffer[geosetIndex].unmap();
                }
                if (geoset.Tangents) {
                    buffers.tangentBuffer[geosetIndex] = device.createBuffer({
                        label: `Tangents ${geosetIndex}`,
                        size: geoset.Tangents.byteLength,
                        usage: GPUBufferUsage.VERTEX,
                        mappedAtCreation: true
                    });
                    new Float32Array(buffers.tangentBuffer[geosetIndex].getMappedRange()).set(geoset.Tangents);
                    buffers.tangentBuffer[geosetIndex].unmap();
                }
            } else {
                // Keep group buffer as u16 to match WebGL and WGSL sentinel checks (65535).
                const groupData = new Uint16Array(geoset.VertexGroup.length * 4);
                for (let j = 0; j < groupData.length; j += 4) {
                    const index = j / 4;
                    const groupIndex = geoset.VertexGroup[index];
                    const group = geoset.Groups && geoset.Groups[groupIndex] ? geoset.Groups[groupIndex] : [0];
                    // Groups contains ObjectIds directly from MDX file
                    groupData[j] = group[0] ?? 0;
                    groupData[j + 1] = group.length > 1 ? group[1] : BONE_SENTINEL;
                    groupData[j + 2] = group.length > 2 ? group[2] : BONE_SENTINEL;
                    groupData[j + 3] = group.length > 3 ? group[3] : BONE_SENTINEL;
                }
                buffers.groupBuffer[geosetIndex] = device.createBuffer({
                    label: `group ${geosetIndex}`,
                    size: groupData.byteLength,
                    usage: GPUBufferUsage.VERTEX,
                    mappedAtCreation: true
                });
                new Uint16Array(buffers.groupBuffer[geosetIndex].getMappedRange()).set(groupData);
                buffers.groupBuffer[geosetIndex].unmap();
            }

            // Index buffer
            const size = Math.ceil(geoset.Faces.byteLength / 4) * 4;
            buffers.indexBuffer[geosetIndex] = device.createBuffer({
                label: `index ${geosetIndex}`,
                size: 2 * size,
                usage: GPUBufferUsage.INDEX,
                mappedAtCreation: true
            });
            new Uint16Array(buffers.indexBuffer[geosetIndex].getMappedRange(0, size)).set(geoset.Faces);
            buffers.indexBuffer[geosetIndex].unmap();

            console.log('[ModelResourceManager] WebGPU buffers created for geoset', geosetIndex);
        }
    }

}
