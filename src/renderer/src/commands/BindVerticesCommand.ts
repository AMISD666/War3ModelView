import { Command } from '../utils/CommandManager'
import { ModelResourceManager } from '../../../../../war3-model-4.0.0/renderer/modelResourceManager'
import { useModelStore } from '../store/modelStore'

interface VertexBindChange {
    geosetIndex: number
    vertexIndex: number
    oldGroupIndex: number
    newGroupIndex: number
}

const toGroupsMatrix = (groups: any): number[][] => {
    if (!Array.isArray(groups)) return []
    return groups.map((group: any) => {
        if (Array.isArray(group)) {
            return group
                .map((value: any) => Number(value))
                .filter((value: number) => Number.isFinite(value) && value >= 0)
                .map((value: number) => Math.floor(value))
        }
        if (group && Array.isArray(group.matrices)) {
            return group.matrices
                .map((value: any) => Number(value))
                .filter((value: number) => Number.isFinite(value) && value >= 0)
                .map((value: number) => Math.floor(value))
        }
        return []
    })
}

const normalizeGeosetSkinning = (geoset: any) => {
    const vertexCount = Math.floor((geoset?.Vertices?.length || 0) / 3)
    const rawGroups = toGroupsMatrix(geoset?.Groups)
    const rawVertexGroup = geoset?.VertexGroup
        ? Array.from(geoset.VertexGroup as ArrayLike<number>, (value) => Number(value) || 0)
        : new Array(vertexCount).fill(0)

    const nextVertexGroupValues = new Array(vertexCount)
    for (let i = 0; i < vertexCount; i++) {
        nextVertexGroupValues[i] = Math.max(0, Math.floor(rawVertexGroup[i] ?? 0))
    }

    if (rawGroups.length === 0) {
        rawGroups.push([0])
    }

    const used = new Set<number>()
    nextVertexGroupValues.forEach((value) => used.add(value))

    const sorted = Array.from(used.values()).sort((a, b) => a - b)
    const remap = new Map<number, number>()
    sorted.forEach((oldId, newId) => remap.set(oldId, newId))

    const compactedGroups = sorted.map((oldId) => {
        const source = rawGroups[oldId]
        if (Array.isArray(source) && source.length > 0) {
            return [...source]
        }
        return [0]
    })

    const maxGroupIndex = Math.max(0, compactedGroups.length - 1)
    const compactedVertexGroupValues = nextVertexGroupValues.map((value) => {
        const remapped = remap.get(value)
        if (remapped === undefined) return 0
        return Math.min(Math.max(0, remapped), maxGroupIndex)
    })

    const TypedArrayCtor = maxGroupIndex > 255 ? Uint16Array : Uint8Array
    geoset.Groups = compactedGroups
    geoset.VertexGroup = new TypedArrayCtor(compactedVertexGroupValues)
    geoset.TotalGroupsCount = compactedGroups.reduce((sum, group) => sum + group.length, 0)
}

export class BindVerticesCommand implements Command {
    private changes: VertexBindChange[] | null = null

    constructor(
        private renderer: any,
        private targets: { geosetIndex: number, vertexIndices: number[] }[],
        private boneId: number,
        private operation: 'bind' | 'unbind'
    ) { }

    execute() {        if (!this.changes) {
            this.calculateChanges()
        }        this.apply(true)
    }

    hasChanges(): boolean {
        return !!this.changes && this.changes.length > 0
    }

    undo() {
        this.apply(false)
    }

    private calculateChanges() {
        this.changes = []
        const model = this.renderer.model
        this.targets.forEach(target => {
            const geoset = model.Geosets[target.geosetIndex]
            if (!geoset || !geoset.VertexGroup || !geoset.Groups) return
            target.vertexIndices.forEach(vIdx => {
                const oldGroupIndex = geoset.VertexGroup[vIdx]
                const oldGroup = geoset.Groups[oldGroupIndex] || [] // Should be array of bone ids

                let newGroup: number[] = []

                // console.log(`[Debug] Vertex ${vIdx} Old Group Index: ${oldGroupIndex} Content:`, oldGroup)

                if (this.operation === 'bind') {
                    // Check if already bound
                    // Using loose equality or finding in array
                    const alreadyBound = oldGroup.some((id: number) => id === this.boneId)

                    if (alreadyBound) {
                        newGroup = [...oldGroup]
                        // console.log('[Debug] Already bound')
                    } else {
                        // limit to 4 bones
                        if (oldGroup.length >= 4) {
                            newGroup = [...oldGroup.slice(1), this.boneId]
                        } else {
                            newGroup = [...oldGroup, this.boneId]
                        }
                    }
                } else {
                    // Unbind
                    newGroup = oldGroup.filter((id: number) => id !== this.boneId)
                }

                // Check if this new group configuration already exists
                let existingGroupIndex = -1
                for (let i = 0; i < geoset.Groups.length; i++) {
                    const g = geoset.Groups[i]
                    if (g.length === newGroup.length && g.every((val: number, index: number) => val === newGroup[index])) {
                        existingGroupIndex = i
                        break
                    }
                }

                if (existingGroupIndex === -1) {
                    // Create new group
                    geoset.Groups.push(newGroup)
                    existingGroupIndex = geoset.Groups.length - 1                }
                // else {
                //      console.log(`[Debug] Found existing group ${existingGroupIndex} for configuration:`, newGroup)
                // }

                if (oldGroupIndex !== existingGroupIndex) {
                    this.changes!.push({
                        geosetIndex: target.geosetIndex,
                        vertexIndex: vIdx,
                        oldGroupIndex,
                        newGroupIndex: existingGroupIndex
                    })
                }
            })
        })
    }

    private apply(useNew: boolean) {
        if (!this.changes) return
        const affectedGeosets = new Set<number>()

        // console.log(`[BindVerticesCommand] Applying changes (useNew=${useNew})`)

        this.changes.forEach(change => {
            const geoset = this.renderer.model.Geosets[change.geosetIndex]
            if (geoset && geoset.VertexGroup) {
                // Check if we need to upgrade from Uint8Array to Uint16Array
                const targetIndex = useNew ? change.newGroupIndex : change.oldGroupIndex
                if (targetIndex > 255 && geoset.VertexGroup instanceof Uint8Array) {
                    console.warn(`[BindVerticesCommand] Upgrading VertexGroup for geoset ${change.geosetIndex} to Uint16Array due to index ${targetIndex}`)
                    geoset.VertexGroup = new Uint16Array(geoset.VertexGroup)
                }

                geoset.VertexGroup[change.vertexIndex] = targetIndex
                affectedGeosets.add(change.geosetIndex)
            }
        })

        affectedGeosets.forEach((geosetIndex) => {
            const geoset = this.renderer.model.Geosets[geosetIndex]
            if (geoset) {
                normalizeGeosetSkinning(geoset)
            }
        })

        const storeGeosets = useModelStore.getState().modelData?.Geosets
        if (Array.isArray(storeGeosets) && storeGeosets.length > 0) {
            const nextGeosets = [...storeGeosets]
            affectedGeosets.forEach((geosetIndex) => {
                const rendererGeoset = this.renderer.model.Geosets[geosetIndex]
                if (!rendererGeoset) return
                nextGeosets[geosetIndex] = {
                    ...nextGeosets[geosetIndex],
                    Groups: rendererGeoset.Groups.map((group: number[]) => [...group]),
                    VertexGroup: rendererGeoset.VertexGroup instanceof Uint16Array
                        ? Array.from(rendererGeoset.VertexGroup)
                        : new Uint8Array(rendererGeoset.VertexGroup)
                }
            })
            useModelStore.getState().setGeosets(nextGeosets as any)
        }

        // Update GPU buffers using ModelResourceManager singleton
        const resourceManager = ModelResourceManager.getInstance()
        affectedGeosets.forEach(geosetIndex => {            if (resourceManager && typeof resourceManager.updateGeosetGroups === 'function') {
                resourceManager.updateGeosetGroups(this.renderer.model, geosetIndex)
            } else {
                console.warn('[BindVerticesCommand] ModelResourceManager.updateGeosetGroups not available')
            }
        })

        // Also force a redraw
        if (this.renderer.emit) {
            this.renderer.emit('change')
        }
    }
}
