import { Command } from '../utils/CommandManager'
import { splitVertices, SplitResult } from '../utils/vertexOperations'
import { useModelStore } from '../store/modelStore'
import { useSelectionStore } from '../store/selectionStore'
import { addWar3GeosetBuffers } from '../infrastructure/render'
import { calculateGeosetExtent, calculateModelExtent } from '../utils/geometryUtils'
import { modelDocumentCommandHandler } from '../application/commands'

interface VertexSelection {
    geosetIndex: number
    index: number
}

const cloneDeep = <T>(value: T): T => {
    if (ArrayBuffer.isView(value)) {
        const Ctor = (value as any).constructor
        return new Ctor(value as any) as T
    }
    if (Array.isArray(value)) {
        return value.map((item) => cloneDeep(item)) as T
    }
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value as Record<string, any>).map(([key, nestedValue]) => [key, cloneDeep(nestedValue)])
        ) as T
    }
    return value
}

/**
 * Command to split vertices and their faces into a new geoset
 * Supports Undo/Redo through CommandManager
 */
export class SplitVerticesCommand implements Command {
    private renderer: any
    private selections: VertexSelection[]
    private geosetIndex: number
    private targetMaterialId?: number
    private splitResult: SplitResult | null = null
    private originalGeosetSnapshot: any = null
    private newGeosetIndex: number = -1

    constructor(renderer: any, selections: VertexSelection[], targetMaterialId?: number) {
        this.renderer = renderer
        this.selections = selections
        this.targetMaterialId = targetMaterialId

        // All selections should be from the same geoset for split
        if (selections.length > 0) {
            this.geosetIndex = selections[0].geosetIndex
        } else {
            this.geosetIndex = -1
        }
    }

    execute(): void {
        if (this.selections.length < 1 || this.geosetIndex < 0) {
            console.warn('[SplitVerticesCommand] Need at least 1 vertex selected')
            return
        }

        const geoset = this.renderer.model.Geosets[this.geosetIndex]
        if (!geoset) return

        // Save original geoset snapshot for undo
        this.originalGeosetSnapshot = {
            Vertices: new Float32Array(geoset.Vertices),
            Normals: new Float32Array(geoset.Normals),
            VertexGroup: new Uint8Array(geoset.VertexGroup),
            Faces: new Uint16Array(geoset.Faces),
            TVertices: geoset.TVertices.map((tv: Float32Array) => new Float32Array(tv)),
            MaterialID: geoset.MaterialID,
            Groups: geoset.Groups ? JSON.parse(JSON.stringify(geoset.Groups)) : [[0]],
            SelectionGroup: geoset.SelectionGroup,
            Unselectable: geoset.Unselectable
        }

        // Get vertex indices
        const vertexIndices = this.selections.map(s => s.index)

        // Perform split
        this.splitResult = splitVertices(geoset, vertexIndices, geoset.MaterialID || 0)

        if (!this.splitResult.extractedFaceIndices.length) {
            console.warn('[SplitVerticesCommand] No faces to extract')
            return
        }        // Update original geoset with remaining geometry (faces removed)
        if (Object.keys(this.splitResult.updatedOriginalGeoset).length > 0) {
            Object.assign(geoset, this.splitResult.updatedOriginalGeoset)
            // Rebuild GPU buffers for modified original geoset
            addWar3GeosetBuffers(this.renderer.model, this.geosetIndex)        }

        // Add new geoset to model
        // Use targetMaterialId if provided, otherwise inherit from source
        const materialId = this.targetMaterialId !== undefined ? this.targetMaterialId : (geoset.MaterialID || 0)
        const newGeoset = {
            ...this.splitResult.newGeoset,
            MaterialID: materialId,
            SelectionGroup: geoset.SelectionGroup || 0,
            Unselectable: geoset.Unselectable || false,
            Groups: geoset.Groups ? JSON.parse(JSON.stringify(geoset.Groups)) : [[0]],
            MinimumExtent: geoset.MinimumExtent || [0, 0, 0],
            MaximumExtent: geoset.MaximumExtent || [0, 0, 0],
            BoundsRadius: geoset.BoundsRadius || 0
        }
        this.renderer.model.Geosets.push(newGeoset)
        this.newGeosetIndex = this.renderer.model.Geosets.length - 1
        // Create GPU buffers for the new geoset
        addWar3GeosetBuffers(this.renderer.model, this.newGeosetIndex)

        // Clear selection
        useSelectionStore.getState().selectVertices([])

        // Sync to store
        this.syncToStore()
    }

    undo(): void {
        if (!this.originalGeosetSnapshot || this.newGeosetIndex < 0) return

        // Restore original geoset
        const geoset = this.renderer.model.Geosets[this.geosetIndex]
        if (geoset) {
            Object.assign(geoset, this.originalGeosetSnapshot)
        }

        // Remove the new geoset
        this.renderer.model.Geosets.splice(this.newGeosetIndex, 1)

        // Rebuild GPU buffers for the restored original geoset
        addWar3GeosetBuffers(this.renderer.model, this.geosetIndex)        // Sync to store and trigger reload
        this.syncToStore()
    }

    private syncToStore(): void {
        const modelStore = useModelStore.getState()
        const geosets = this.renderer.model.Geosets
        const previousHiddenIds = modelStore.hiddenGeosetIds
        const nextGeosets = geosets.map((g: any) => ({
            ...g,
            Vertices: Array.from(g.Vertices),
            Normals: Array.from(g.Normals),
            VertexGroup: Array.from(g.VertexGroup),
            Faces: Array.from(g.Faces),
            TVertices: g.TVertices.map((tv: Float32Array) => Array.from(tv)),
            Groups: g.Groups ? JSON.parse(JSON.stringify(g.Groups)) : [[0]]
        }))

        nextGeosets.forEach((geoset: any) => calculateGeosetExtent(geoset))

        const sourceGeosetAnims = Array.isArray(modelStore.modelData?.GeosetAnims)
            ? modelStore.modelData!.GeosetAnims.map((anim: any) => cloneDeep(anim))
            : []
        const hasNewGeoset = this.newGeosetIndex >= 0 && this.newGeosetIndex < nextGeosets.length
        if (hasNewGeoset) {
            const sourceAnim = sourceGeosetAnims.find((anim: any) => Number(anim?.GeosetId) === this.geosetIndex)
            if (sourceAnim) {
                sourceGeosetAnims.push({
                    ...cloneDeep(sourceAnim),
                    GeosetId: this.newGeosetIndex
                })
            }
        }

        const nextHiddenIds = hasNewGeoset
            ? Array.from(new Set(
                previousHiddenIds
                    .filter((id) => id >= 0 && id < nextGeosets.length)
                    .concat(this.newGeosetIndex)
            )).sort((a, b) => a - b)
            : previousHiddenIds.filter((id) => id >= 0 && id < nextGeosets.length)

        if (!modelStore.modelData) return

        const nextModelData: any = {
            ...modelStore.modelData,
            Geosets: nextGeosets,
            GeosetAnims: sourceGeosetAnims,
            __forceFullReload: true
        }

        if (nextModelData.Model && typeof nextModelData.Model === 'object') {
            nextModelData.Model = {
                ...nextModelData.Model,
                NumGeosets: nextGeosets.length,
                NumGeosetAnims: sourceGeosetAnims.length
            }
        }

        calculateModelExtent(nextModelData)

        modelDocumentCommandHandler.replaceDocumentSnapshot({
            name: 'Split Vertices',
            before: null,
            after: {
                modelData: nextModelData,
                hiddenGeosetIds: nextHiddenIds,
            },
            options: { recordHistory: false },
            applyOptions: { rendererReload: true },
        })

        // Force renderer reload to rebuild GPU buffers
        if (this.renderer.reload) {
            this.renderer.reload()        }
    }
}
