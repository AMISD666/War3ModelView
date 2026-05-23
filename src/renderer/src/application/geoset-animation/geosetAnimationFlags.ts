export const GEOSET_ANIM_DROP_SHADOW_FLAG = 1
export const GEOSET_ANIM_COLOR_FLAG = 2

type GeosetAnimLike = {
    Flags?: unknown
    UseColor?: unknown
    DropShadow?: unknown
}

const readFlags = (anim: GeosetAnimLike | null | undefined): number => {
    const flags = anim?.Flags
    return typeof flags === 'number' && Number.isFinite(flags) ? flags : 0
}

export const geosetAnimUsesColor = (anim: GeosetAnimLike | null | undefined): boolean =>
    (readFlags(anim) & GEOSET_ANIM_COLOR_FLAG) !== 0 || anim?.UseColor === true

export const geosetAnimDropsShadow = (anim: GeosetAnimLike | null | undefined): boolean =>
    (readFlags(anim) & GEOSET_ANIM_DROP_SHADOW_FLAG) !== 0 || anim?.DropShadow === true

export const setGeosetAnimColorEnabled = <T extends GeosetAnimLike>(anim: T, enabled: boolean): T => {
    const flags = enabled ? readFlags(anim) | GEOSET_ANIM_COLOR_FLAG : readFlags(anim) & ~GEOSET_ANIM_COLOR_FLAG
    return { ...anim, Flags: flags, UseColor: enabled }
}

export const setGeosetAnimDropShadowEnabled = <T extends GeosetAnimLike>(anim: T, enabled: boolean): T => {
    const flags = enabled ? readFlags(anim) | GEOSET_ANIM_DROP_SHADOW_FLAG : readFlags(anim) & ~GEOSET_ANIM_DROP_SHADOW_FLAG
    return { ...anim, Flags: flags, DropShadow: enabled }
}
