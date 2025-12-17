import { Command } from '../utils/CommandManager'
import { ModelResourceManager } from '../../../../../war3-model-4.0.0/renderer/modelResourceManager'

interface VertexBindChange {
    geosetIndex: number
    vertexIndex: number
    oldGroupIndex: number
    newGroupIndex: number
}

export class BindVerticesCommand implements Command {
    private changes: VertexBindChange[] | null = null

    constructor(
        private renderer: any,
        private targets: { geosetIndex: number, vertexIndices: number[] }[],
        private boneId: number,
        private operation: 'bind' | 'unbind'
    ) { }

    execute() {
        console.log('[BindVerticesCommand] Execute called')
        if (!this.changes) {
            this.calculateChanges()
        }
        console.log('[BindVerticesCommand] Changes count:', this.changes?.length ?? 0)
        this.apply(true)
    }

    undo() {
        console.log('[BindVerticesCommand] Undo called')
        this.apply(false)
    }

    private calculateChanges() {
        this.changes = []
        const model = this.renderer.model
        console.log('[BindVerticesCommand] Calculating changes. Targets:', this.targets.length, 'BoneId:', this.boneId, 'Op:', this.operation)

        this.targets.forEach(target => {
            const geoset = model.Geosets[target.geosetIndex]
            if (!geoset || !geoset.VertexGroup || !geoset.Groups) return

            console.log(`[BindVerticesCommand] Processing geoset ${target.geosetIndex}. Vertices: ${target.vertexIndices.length}`)

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
                    existingGroupIndex = geoset.Groups.length - 1
                    console.log(`[BindVerticesCommand] Created new group ${existingGroupIndex} for configuration:`, newGroup)
                }
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

        // Update GPU buffers using ModelResourceManager singleton
        const resourceManager = ModelResourceManager.getInstance()
        affectedGeosets.forEach(geosetIndex => {
            console.log(`[BindVerticesCommand] Updating GPU buffers for geoset ${geosetIndex}`)
            if (resourceManager && typeof resourceManager.updateGeosetGroups === 'function') {
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
