import { FilterMode } from '../model';
import {
    getWar3FilterDrawRank,
    isModulateFilterMode,
    isOpaqueMeshFilterMode
} from './War3BlendState';

export type War3RenderPass = 'opaque' | 'transparent';

export type TransparentRenderEntry =
    | {
        kind: 'layer';
        geosetIndex: number;
        layerIndex: number;
        filterMode: number;
        priorityPlane: number;
        dist2: number;
    }
    | {
        kind: 'hdGeoset';
        geosetIndex: number;
        filterMode: number;
        priorityPlane: number;
        dist2: number;
    }
    | {
        kind: 'particle2';
        instanceIndex: number;
        emitterIndex: number;
        filterMode: number;
        priorityPlane: number;
        dist2: number;
    }
    | {
        kind: 'ribbon';
        instanceIndex: number;
        emitterIndex: number;
        layerIndex: number;
        filterMode: number;
        priorityPlane: number;
        dist2: number;
    };

export const shouldDrawLayerInPass = (filterMode: number, renderPass: War3RenderPass): boolean =>
    renderPass === 'opaque' ? isOpaqueMeshFilterMode(filterMode) : !isOpaqueMeshFilterMode(filterMode);

export const shouldDrawEffectInModulatePass = (filterMode: number): boolean =>
    isModulateFilterMode(filterMode);

export const shouldDrawEffectInTransparentPass = (filterMode: number): boolean =>
    !isModulateFilterMode(filterMode);

const getKindOrder = (kind: TransparentRenderEntry['kind']): number => {
    if (kind === 'layer' || kind === 'hdGeoset') return 0;
    if (kind === 'ribbon') return 1;
    return 2;
};

export const compareTransparentRenderEntries = (
    a: TransparentRenderEntry,
    b: TransparentRenderEntry
): number => {
    if (a.priorityPlane !== b.priorityPlane) return a.priorityPlane - b.priorityPlane;

    if (a.dist2 !== b.dist2) return b.dist2 - a.dist2;

    const rankA = getWar3FilterDrawRank(a.filterMode);
    const rankB = getWar3FilterDrawRank(b.filterMode);
    if (rankA !== rankB) return rankA - rankB;

    const kindOrderA = getKindOrder(a.kind);
    const kindOrderB = getKindOrder(b.kind);
    if (kindOrderA !== kindOrderB) return kindOrderA - kindOrderB;

    if (a.kind === 'layer' && b.kind === 'layer') {
        if (a.geosetIndex !== b.geosetIndex) return a.geosetIndex - b.geosetIndex;
        return a.layerIndex - b.layerIndex;
    }

    if (a.kind === 'hdGeoset' && b.kind === 'hdGeoset') {
        return a.geosetIndex - b.geosetIndex;
    }

    if (a.kind === 'ribbon' && b.kind === 'ribbon') {
        if (a.instanceIndex !== b.instanceIndex) return a.instanceIndex - b.instanceIndex;
        if (a.emitterIndex !== b.emitterIndex) return a.emitterIndex - b.emitterIndex;
        return a.layerIndex - b.layerIndex;
    }

    if (a.kind === 'particle2' && b.kind === 'particle2') {
        if (a.instanceIndex !== b.instanceIndex) return a.instanceIndex - b.instanceIndex;
        return a.emitterIndex - b.emitterIndex;
    }

    if (
        (a.kind === 'particle2' || a.kind === 'ribbon') &&
        (b.kind === 'particle2' || b.kind === 'ribbon')
    ) {
        if (a.instanceIndex !== b.instanceIndex) return a.instanceIndex - b.instanceIndex;
        if (a.emitterIndex !== b.emitterIndex) return a.emitterIndex - b.emitterIndex;
    }

    return 0;
};

export const getDefaultLayerFilterMode = (filterMode: number | undefined): number =>
    filterMode ?? FilterMode.None;
