export const MATERIAL_FILTER_MODE_OPTIONS = [
    { value: 0, label: 'None' },
    { value: 1, label: 'Transparent' },
    { value: 2, label: 'Blend' },
    { value: 3, label: 'Additive' },
    { value: 4, label: 'Add Alpha' },
    { value: 5, label: 'Modulate' },
    { value: 6, label: 'Modulate 2X' },
] as const

export const MATERIAL_FILTER_MODE_LABELS = MATERIAL_FILTER_MODE_OPTIONS.map((option) => option.label)
