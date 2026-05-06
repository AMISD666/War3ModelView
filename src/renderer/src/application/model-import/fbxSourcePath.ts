export const isFbxSourcePath = (path: string | null | undefined): boolean =>
    typeof path === 'string' && path.toLowerCase().endsWith('.fbx')

export const FBX_SOURCE_SAVE_WARNING = 'FBX 是导入源格式，请使用导出 MDX 或导出 MDL 保存转换结果。'
export const FBX_PRO_FEATURE_NAME = 'FBX 模型加载和转换'
