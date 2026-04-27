import { desktopGateway, type DesktopGateway } from '../../infrastructure/desktop'

export interface TextureBatchCacheStats {
    path_entries: number
    path_limit: number
    result_entries: number
    result_limit: number
    result_total_bytes: number
    result_max_bytes: number
    rgba_entries: number
    rgba_limit: number
    rgba_total_bytes: number
    rgba_max_bytes: number
    fs_path_cache_hits: number
    fs_result_cache_hits: number
    fs_result_cache_misses: number
    mpq_result_cache_hits: number
    mpq_result_cache_misses: number
    fs_path_stale_invalidations: number
    fs_resolved: number
    mpq_resolved: number
    rgba_cache_hits: number
    rgba_cache_misses: number
    not_found: number
    path_evictions: number
    result_evictions: number
    rgba_evictions: number
    clears: number
}

export const getTextureBatchCacheStats = (
    desktop: DesktopGateway = desktopGateway,
): Promise<TextureBatchCacheStats> => {
    return desktop.invoke<TextureBatchCacheStats>('get_texture_batch_cache_stats')
}

export const clearTextureBatchCache = (
    desktop: DesktopGateway = desktopGateway,
): Promise<void> => {
    return desktop.invoke<void>('clear_texture_batch_cache')
}
