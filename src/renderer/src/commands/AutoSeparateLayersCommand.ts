import { Command } from '../utils/CommandManager'
import { useModelStore } from '../store/modelStore'
import { useSelectionStore } from '../store/selectionStore'
import { ModelData } from '../types/model'
import { calculateGeosetExtent, calculateModelExtent } from '../utils/geometryUtils'
import { modelDocumentCommandHandler } from '../application/commands'
import { cloneGeoset, cloneGeosets, splitGeosetByVertexLimit } from './AutoSeparateLayersSplitter'

type AutoSeparateLayersResult = {
    sourceGeosetCount: number
    resultGeosetCount: number
    changedGeosetCount: number
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

const cloneGeosetAnim = (anim: any) => cloneDeep(anim)

const cloneGeosetAnims = (geosetAnims: any[]) => geosetAnims.map((anim) => cloneGeosetAnim(anim))

const remapGeosetAnims = (geosetAnims: any[], geosetIndexMap: number[][]): any[] => {
    const nextGeosetAnims: any[] = []

    for (const anim of geosetAnims) {
        const sourceGeosetId = typeof anim?.GeosetId === 'number' ? anim.GeosetId : null
        if (sourceGeosetId === null || sourceGeosetId < 0 || sourceGeosetId >= geosetIndexMap.length) {
            nextGeosetAnims.push(cloneGeosetAnim(anim))
            continue
        }

        const mappedGeosetIds = geosetIndexMap[sourceGeosetId] || []
        if (mappedGeosetIds.length === 0) {
            continue
        }

        for (const mappedGeosetId of mappedGeosetIds) {
            nextGeosetAnims.push({
                ...cloneGeosetAnim(anim),
                GeosetId: mappedGeosetId
            })
        }
    }

    return nextGeosetAnims
}

const updateHeaderCounts = (modelData: any, geosetsCount: number, geosetAnimsCount: number) => {
    if (!modelData || typeof modelData !== 'object') return
    if (!modelData.Model || typeof modelData.Model !== 'object') return
    modelData.Model = {
        ...modelData.Model,
        NumGeosets: geosetsCount,
        NumGeosetAnims: geosetAnimsCount
    }
}

export class AutoSeparateLayersCommand implements Command {
    name = 'Auto Separate Layers'

    private renderer: any
    private originalGeosetsSnapshot: any[] | null = null
    private originalGeosetAnimsSnapshot: any[] | null = null
    private separatedGeosetsSnapshot: any[] | null = null
    private separatedGeosetAnimsSnapshot: any[] | null = null
    public lastResult: AutoSeparateLayersResult | null = null

    constructor(renderer: any) {
        this.renderer = renderer
    }

    execute(): void {
        const modelStore = useModelStore.getState()
        const sourceGeosets = modelStore.modelData?.Geosets as any[] | undefined
        const sourceGeosetAnims = (modelStore.modelData?.GeosetAnims as any[] | undefined) || []
        if (!sourceGeosets) return

        if (this.separatedGeosetsSnapshot && this.separatedGeosetAnimsSnapshot) {
            this.lastResult = {
                sourceGeosetCount: this.originalGeosetsSnapshot?.length || this.separatedGeosetsSnapshot.length,
                resultGeosetCount: this.separatedGeosetsSnapshot.length,
                changedGeosetCount: Math.max(0, this.separatedGeosetsSnapshot.length - (this.originalGeosetsSnapshot?.length || 0))
            }
            useSelectionStore.getState().clearAllSelections()
            this.syncToStore(this.separatedGeosetsSnapshot, this.separatedGeosetAnimsSnapshot)
            return
        }

        this.originalGeosetsSnapshot = cloneGeosets(sourceGeosets)
        this.originalGeosetAnimsSnapshot = cloneGeosetAnims(sourceGeosetAnims)

        const nextGeosets: any[] = []
        const geosetIndexMap: number[][] = []
        let changedGeosetCount = 0
        for (const [sourceGeosetIndex, geoset] of this.originalGeosetsSnapshot.entries()) {
            const splitGeosets = splitGeosetByVertexLimit(geoset)
            if (splitGeosets.length > 1) {
                changedGeosetCount++
            }
            geosetIndexMap[sourceGeosetIndex] = []
            for (const splitGeoset of splitGeosets) {
                geosetIndexMap[sourceGeosetIndex].push(nextGeosets.length)
                nextGeosets.push(splitGeoset)
            }
        }

        const nextGeosetAnims = remapGeosetAnims(this.originalGeosetAnimsSnapshot, geosetIndexMap)

        this.separatedGeosetsSnapshot = cloneGeosets(nextGeosets)
        this.separatedGeosetAnimsSnapshot = cloneGeosetAnims(nextGeosetAnims)
        this.lastResult = {
            sourceGeosetCount: this.originalGeosetsSnapshot.length,
            resultGeosetCount: nextGeosets.length,
            changedGeosetCount
        }
        useSelectionStore.getState().clearAllSelections()
        this.syncToStore(this.separatedGeosetsSnapshot, this.separatedGeosetAnimsSnapshot)
    }

    undo(): void {
        if (!this.originalGeosetsSnapshot || !this.originalGeosetAnimsSnapshot) return
        this.syncToStore(this.originalGeosetsSnapshot, this.originalGeosetAnimsSnapshot)
    }

    private syncToStore(geosetsSnapshot: any[], geosetAnimsSnapshot: any[]): void {
        const state = useModelStore.getState()
        if (!state.modelData) return

        const nextModelData = {
            ...state.modelData,
            Geosets: cloneGeosets(geosetsSnapshot) as any,
            GeosetAnims: cloneGeosetAnims(geosetAnimsSnapshot) as any,
            __forceFullReload: true
        } as ModelData & { __forceFullReload?: boolean }

        ;(nextModelData.Geosets || []).forEach((geoset: any) => calculateGeosetExtent(geoset))
        updateHeaderCounts(nextModelData, nextModelData.Geosets?.length || 0, nextModelData.GeosetAnims?.length || 0)
        calculateModelExtent(nextModelData)

        const nextGeosetCount = nextModelData.Geosets?.length || 0
        const validHiddenGeosetIds = (state.hiddenGeosetIds || []).filter(
            (index) => index >= 0 && index < nextGeosetCount
        )

        modelDocumentCommandHandler.replaceDocumentSnapshot({
            name: this.name,
            before: null,
            after: {
                modelData: nextModelData,
                hiddenGeosetIds: validHiddenGeosetIds,
                selectedGeosetIndex: null,
                selectedGeosetIndices: [],
            },
            options: { recordHistory: false },
            applyOptions: { rendererReload: true },
        })
    }
}


