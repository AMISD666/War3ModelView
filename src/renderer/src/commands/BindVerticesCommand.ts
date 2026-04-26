import { Command } from '../utils/CommandManager'
import { useModelStore } from '../store/modelStore'
import { useRendererStore } from '../store/rendererStore'

interface VertexBindChange {
    geosetIndex: number
    vertexIndex: number
    oldGroup: number[]
    newGroup: number[]
}

const toGroup = (group: any): number[] => {
    if (!Array.isArray(group)) return []
    return group
        .map((value: any) => Number(value))
        .filter((value: number) => Number.isFinite(value) && value >= 0)
        .map((value: number) => Math.floor(value))
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

const groupsEqual = (a: number[], b: number[]): boolean => {
    return a.length === b.length && a.every((value, index) => value === b[index])
}

const findOrCreateGroup = (geoset: any, group: number[]): number => {
    if (!Array.isArray(geoset.Groups)) {
        geoset.Groups = []
    }

    const normalized = group.length > 0 ? [...group] : [0]
    for (let i = 0; i < geoset.Groups.length; i++) {
        if (groupsEqual(toGroup(geoset.Groups[i]), normalized)) {
            return i
        }
    }

    geoset.Groups.push(normalized)
    return geoset.Groups.length - 1
}

const writeSkinWeightsForVertex = (geoset: any, vertexIndex: number): void => {
    if (!geoset?.SkinWeights || !geoset?.VertexGroup || !Array.isArray(geoset.Groups)) return
    const base = vertexIndex * 8
    if (base < 0 || base + 7 >= geoset.SkinWeights.length) return

    const groupIndex = geoset.VertexGroup[vertexIndex]
    const group = toGroup(geoset.Groups[groupIndex]).slice(0, 4)
    const bones = group.length > 0 ? group : [0]
    const baseWeight = Math.floor(255 / bones.length)
    let remainder = 255 - baseWeight * bones.length

    for (let i = 0; i < 4; i++) {
        geoset.SkinWeights[base + i] = bones[i] !== undefined ? Math.min(255, Math.max(0, bones[i])) : 0
        if (i < bones.length) {
            geoset.SkinWeights[base + 4 + i] = baseWeight + (remainder > 0 ? 1 : 0)
            remainder -= 1
        } else {
            geoset.SkinWeights[base + 4 + i] = 0
        }
    }
}

export class BindVerticesCommand implements Command {
    private changes: VertexBindChange[] | null = null

    constructor(
        private renderer: any,
        private targets: { geosetIndex: number, vertexIndices: number[] }[],
        private boneId: number,
        private operation: 'bind' | 'unbind' | 'exclusiveBind'
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
                const oldGroup = toGroup(geoset.Groups[oldGroupIndex]) // Should be array of bone ids

                let newGroup: number[] = []

                // console.log(`[Debug] Vertex ${vIdx} Old Group Index: ${oldGroupIndex} Content:`, oldGroup)

                if (this.operation === 'exclusiveBind') {
                    newGroup = [this.boneId]
                } else if (this.operation === 'bind') {
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
                if (!groupsEqual(oldGroup, newGroup)) {
                    this.changes!.push({
                        geosetIndex: target.geosetIndex,
                        vertexIndex: vIdx,
                        oldGroup,
                        newGroup
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
                const targetGroup = useNew ? change.newGroup : change.oldGroup
                const targetIndex = findOrCreateGroup(geoset, targetGroup)
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

        this.changes.forEach((change) => {
            const geoset = this.renderer.model.Geosets[change.geosetIndex]
            writeSkinWeightsForVertex(geoset, change.vertexIndex)
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
                    TotalGroupsCount: rendererGeoset.TotalGroupsCount,
                    VertexGroup: rendererGeoset.VertexGroup instanceof Uint16Array
                        ? Array.from(rendererGeoset.VertexGroup)
                        : new Uint8Array(rendererGeoset.VertexGroup),
                    ...(rendererGeoset.SkinWeights ? { SkinWeights: new Uint8Array(rendererGeoset.SkinWeights) } : {})
                } as any
            })
            useModelStore.getState().setGeosets(nextGeosets as any)
        }

        // Update GPU skinning buffers through the active renderer instance.
        affectedGeosets.forEach(geosetIndex => {
            if (typeof this.renderer.updateGeosetGroups === 'function') {
                this.renderer.updateGeosetGroups(geosetIndex)
            } else {
                console.warn('[BindVerticesCommand] renderer.updateGeosetGroups not available')
            }
        })

        if (affectedGeosets.size > 0) {
            useRendererStore.getState().bumpVertexRenderRevision()
        }

        // Also force a redraw
        if (this.renderer.emit) {
            this.renderer.emit('change')
        }
    }
}
