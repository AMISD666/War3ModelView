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

export const PARTICLE_EMITTER2_FILTER_MODE_OPTIONS = [
    { value: 6, label: 'None' },
    { value: 4, label: 'Transparent' },
    { value: 0, label: 'Blend' },
    { value: 1, label: 'Additive' },
    { value: 5, label: 'Add Alpha' },
    { value: 2, label: 'Modulate' },
    { value: 3, label: 'Modulate 2X' },
] as const

export const PARTICLE_EMITTER2_FILTER_MODE_LABELS = PARTICLE_EMITTER2_FILTER_MODE_OPTIONS.map((option) => option.label)
