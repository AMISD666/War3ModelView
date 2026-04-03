export type MaterialTrackField = 'TextureID' | 'Alpha'

export const getMaterialTrackEditorTitle = (field: MaterialTrackField): string => (
    field === 'TextureID' ? '编辑材质贴图 ID 关键帧' : '编辑材质透明度关键帧'
)

export const getMaterialTrackFieldName = (
    field: MaterialTrackField,
    materialIndex: number,
    layerIndex: number
): string => `${field}_${materialIndex}_${layerIndex}`
