import { Command } from '../utils/CommandManager'
import { deleteVertices, DeleteResult } from '../utils/vertexOperations'
import { useModelStore } from '../store/modelStore'
import { useSelectionStore } from '../store/selectionStore'
import { addWar3GeosetBuffers } from '../infrastructure/render'
import { syncRendererGeosetBuffers } from '../application/render'
import { modelDocumentCommandHandler } from '../application/commands'
import {
    cloneGeosetAnims,
    remapGeosetAnimsAfterRemovingGeosets,
    syncRendererGeosetAnims
} from './geosetAnimRemap'

interface VertexSelection {
    geosetIndex: number
    index: number
}

const cloneTypedArray = <T extends ArrayLike<number>>(value: T | undefined | null): T | null => {
    if (!value) return null
    const Ctor = (value as any).constructor
    return new Ctor(value) as T
}

const cloneGeosetSnapshot = (geoset: any) => ({
    ...geoset,
    Vertices: cloneTypedArray(geoset?.Vertices) ?? new Float32Array(),
    Normals: cloneTypedArray(geoset?.Normals) ?? new Float32Array(),
    VertexGroup: cloneTypedArray(geoset?.VertexGroup) ?? new Uint8Array(),
    Faces: cloneTypedArray(geoset?.Faces) ?? new Uint16Array(),
    TVertices: Array.isArray(geoset?.TVertices)
        ? geoset.TVertices.map((tv: Float32Array | number[]) => cloneTypedArray(tv) ?? new Float32Array())
        : [],
    Tangents: cloneTypedArray(geoset?.Tangents),
    SkinWeights: cloneTypedArray(geoset?.SkinWeights),
    Groups: geoset?.Groups ? JSON.parse(JSON.stringify(geoset.Groups)) : [[0]],
    MinimumExtent: Array.isArray(geoset?.MinimumExtent) ? [...geoset.MinimumExtent] : geoset?.MinimumExtent,
    MaximumExtent: Array.isArray(geoset?.MaximumExtent) ? [...geoset.MaximumExtent] : geoset?.MaximumExtent,
    Anims: geoset?.Anims ? JSON.parse(JSON.stringify(geoset.Anims)) : geoset?.Anims
})

/**
 * Command to delete vertices and their faces
 * Supports Undo/Redo through CommandManager
 */
export class DeleteVerticesCommand implements Command {
    private renderer: any
    private selections: VertexSelection[]
    private geosetIndex: number
    private originalGeosetSnapshot: any = null
    private originalGeosetAnimsSnapshot: any[] | null = null
    private deleteResult: DeleteResult | null = null
    private removedGeoset = false

    constructor(renderer: any, selections: VertexSelection[]) {
        this.renderer = renderer
        this.selections = selections

        // All selections should be from the same geoset
        if (selections.length > 0) {
            this.geosetIndex = selections[0].geosetIndex
        } else {
            this.geosetIndex = -1
        }
    }

    execute(): void {
        if (this.selections.length < 1 || this.geosetIndex < 0) {
            console.warn('[DeleteVerticesCommand] Need at least 1 vertex selected')
            return
        }

        const geoset = this.renderer.model.Geosets[this.geosetIndex]
        if (!geoset) return

        // Save original geoset snapshot for undo
        this.originalGeosetSnapshot = cloneGeosetSnapshot(geoset)
        this.originalGeosetAnimsSnapshot = cloneGeosetAnims(this.getCurrentGeosetAnims())

        // Get vertex indices
        const vertexIndices = this.selections.map(s => s.index)

        // Perform delete
        this.deleteResult = deleteVertices(geoset, vertexIndices)

        const shouldRemoveGeoset =
            (this.deleteResult.updatedGeoset.Vertices?.length || 0) === 0 ||
            (this.deleteResult.updatedGeoset.Faces?.length || 0) === 0

        if (shouldRemoveGeoset) {
            this.renderer.model.Geosets.splice(this.geosetIndex, 1)
            const nextGeosetAnims = remapGeosetAnimsAfterRemovingGeosets(
                this.originalGeosetAnimsSnapshot,
                [this.geosetIndex]
            )
            syncRendererGeosetAnims(this.renderer, nextGeosetAnims)
            this.removedGeoset = true
        } else {
            Object.assign(geoset, this.deleteResult.updatedGeoset)
            addWar3GeosetBuffers(this.renderer.model, this.geosetIndex)
            syncRendererGeosetBuffers(this.renderer, [this.geosetIndex], {
                vertices: true,
                normals: true,
                texCoords: true,
                groups: true,
            })
            this.removedGeoset = false
        }

        useSelectionStore.getState().selectVertices([])

        // Sync to store
        this.syncToStore()
    }

    undo(): void {
        if (!this.originalGeosetSnapshot) return

        if (this.removedGeoset) {
            this.renderer.model.Geosets.splice(this.geosetIndex, 0, cloneGeosetSnapshot(this.originalGeosetSnapshot))
            if (this.originalGeosetAnimsSnapshot) {
                syncRendererGeosetAnims(this.renderer, this.originalGeosetAnimsSnapshot)
            }
        } else {
            const geoset = this.renderer.model.Geosets[this.geosetIndex]
            if (geoset) {
                Object.assign(geoset, cloneGeosetSnapshot(this.originalGeosetSnapshot))
            }
        }

        addWar3GeosetBuffers(this.renderer.model, this.geosetIndex)
        syncRendererGeosetBuffers(this.renderer, [this.geosetIndex], {
            vertices: true,
            normals: true,
            texCoords: true,
            groups: true,
        })

        this.syncToStore()
    }

    private getCurrentGeosetAnims(): any[] {
        if (Array.isArray(this.renderer?.model?.GeosetAnims)) {
            return this.renderer.model.GeosetAnims
        }
        return useModelStore.getState().modelData?.GeosetAnims ?? []
    }

    private syncToStore(): void {
        const nextGeosets = this.renderer.model.Geosets.map((geoset: any) => ({
            ...geoset,
            Vertices: Array.from(geoset.Vertices || []),
            Normals: Array.from(geoset.Normals || []),
            VertexGroup: Array.from(geoset.VertexGroup || []),
            Faces: Array.from(geoset.Faces || []),
            TVertices: Array.isArray(geoset.TVertices)
                ? geoset.TVertices.map((tv: Float32Array) => Array.from(tv))
                : [],
            Groups: geoset.Groups ? JSON.parse(JSON.stringify(geoset.Groups)) : [[0]]
        }))

        const modelState = useModelStore.getState()
        modelDocumentCommandHandler.replaceGeosetList({
            name: 'Delete Vertices: Sync Geosets',
            before: modelState.modelData?.Geosets ?? [],
            after: nextGeosets,
            options: { recordHistory: false },
        })
        modelDocumentCommandHandler.replaceGeosetAnimationList({
            name: 'Delete Vertices: Sync Geoset Animations',
            before: modelState.modelData?.GeosetAnims ?? [],
            after: cloneGeosetAnims(this.getCurrentGeosetAnims()),
            options: { recordHistory: false },
        })
    }
}
