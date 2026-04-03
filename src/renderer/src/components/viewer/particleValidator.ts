/**
 * particleValidator - Utility functions for validating and fixing particle emitter data
 * Fixes production-only rendering issues caused by invalid/missing properties
 */

/** 内存合并后 AnimVector.Keys 可能为 {0:kf,1:kf}，与 MDX 解析的数组不一致，会导致插值/发射率为 0 */
function normalizeAnimVectorKeysInPlace(av: any): void {
    if (!av || typeof av !== 'object' || av.Keys == null) return;
    if (Array.isArray(av.Keys)) return;
    if (typeof av.Keys === 'object') {
        const nk = Object.keys(av.Keys)
            .filter((k) => /^\d+$/.test(k))
            .sort((a, b) => Number(a) - Number(b));
        if (nk.length > 0) {
            av.Keys = nk.map((k) => av.Keys[k]);
        }
    }
}

const PE2_ANIM_VECTOR_FIELDS = [
    'EmissionRate',
    'Speed',
    'Variation',
    'Latitude',
    'Width',
    'Length',
    'Gravity',
    'Visibility',
    'EmissionRateAnim',
    'SpeedAnim',
    'VariationAnim',
    'LatitudeAnim',
    'WidthAnim',
    'LengthAnim',
    'GravityAnim',
    'VisibilityAnim',
] as const;

/**
 * Validate and fix a single ParticleEmitter2
 * Ensures all required properties are present and properly formatted
 */
export function validateParticleEmitter2(emitter: any, idx: number, textureCount: number): void {
    // Fix 1: TextureID - change -1 or invalid to 0 (first texture)
    if (emitter.TextureID === undefined || emitter.TextureID === null ||
        emitter.TextureID < 0 || emitter.TextureID >= textureCount) {
        // // console.log(`[particleValidator] Particle ${idx} "${emitter.Name}": TextureID ${emitter.TextureID} -> 0`)
        emitter.TextureID = textureCount > 0 ? 0 : 0
    }

    // Fix 2: Reconstruct Flags bitmask from boolean properties
    // war3-model expects numeric Flags, not individual booleans
    // ParticleEmitter2Flags: Unshaded=32768, SortPrimsFarZ=65536, LineEmitter=131072,
    //                        Unfogged=262144, ModelSpace=524288, XYQuad=1048576
    let flags = typeof emitter.Flags === 'number' ? emitter.Flags : 0
    if (emitter.Unshaded === true) flags |= 32768
    if (emitter.SortPrimsFarZ === true) flags |= 65536
    if (emitter.LineEmitter === true) flags |= 131072
    if (emitter.Unfogged === true) flags |= 262144
    if (emitter.ModelSpace === true) flags |= 524288
    if (emitter.XYQuad === true) flags |= 1048576

    emitter.Flags = flags

    // Fix 3: Reconstruct FrameFlags from Head/Tail booleans
    let frameFlags = typeof emitter.FrameFlags === 'number' ? emitter.FrameFlags : 0
    if (emitter.Head === true) frameFlags |= 1
    if (emitter.Tail === true) frameFlags |= 2
    // Default to Head if neither is set
    if (frameFlags === 0) frameFlags = 1
    emitter.FrameFlags = frameFlags

    PE2_ANIM_VECTOR_FIELDS.forEach((f) => normalizeAnimVectorKeysInPlace(emitter[f]))

    // Fix 4: Convert arrays to typed arrays expected by war3-model renderer
    if (emitter.ParticleScaling && !(emitter.ParticleScaling instanceof Float32Array)) {
        emitter.ParticleScaling = new Float32Array(emitter.ParticleScaling)
    }
    if (emitter.Alpha && !(emitter.Alpha instanceof Uint8Array)) {
        emitter.Alpha = new Uint8Array(emitter.Alpha)
    }
    if (emitter.SegmentColor && Array.isArray(emitter.SegmentColor)) {
        emitter.SegmentColor = emitter.SegmentColor.map((c: any) =>
            c instanceof Float32Array ? c : new Float32Array(c)
        )
    }

    // Convert UV anim arrays if needed
    // Handle object format {"0": n, "1": n, "2": n} from store spread operations
    // BUT preserve Uint32Array (from MDX parser) and Float32Array (already converted)
    const uvAnimProps = ['LifeSpanUVAnim', 'DecayUVAnim', 'TailUVAnim', 'TailDecayUVAnim']
    uvAnimProps.forEach(prop => {
        let val = emitter[prop]
        if (!val) return

        // Skip if already a typed array (Uint32Array from parser, or Float32Array)
        if (val instanceof Uint32Array || val instanceof Float32Array) {
            return
        }

        // If it's an object with numeric keys (from spread), convert to array first
        if (!Array.isArray(val) && typeof val === 'object' && '0' in val) {
            val = [val['0'] ?? 0, val['1'] ?? 0, val['2'] ?? 1]
        }
        // Convert to Uint32Array (frame indices are integers)
        if (Array.isArray(val)) {
            emitter[prop] = new Uint32Array(val)
        }
    })}

/**
 * Validate all ParticleEmitter2 in a model
 */
export function validateAllParticleEmitters(model: any): void {
    if (!model.ParticleEmitters2 || model.ParticleEmitters2.length === 0) return

    const textureCount = model.Textures?.length || 0
    model.ParticleEmitters2.forEach((emitter: any, idx: number) => {
        validateParticleEmitter2(emitter, idx, textureCount)
    })
}
