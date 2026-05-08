import { FilterMode, LayerShading, ParticleEmitter2FilterMode } from '../model';

export const TRANSPARENT_ALPHA_TEST_LEVEL = 0.75;
export const PARTICLE_ALPHA_KEY_TEST_LEVEL = 0.75;
export const MODULATE_ALPHA_TEST_LEVEL = 0.01;

export const isOpaqueMeshFilterMode = (filterMode: number): boolean =>
    filterMode === FilterMode.None || filterMode === FilterMode.Transparent;

export const isModulateFilterMode = (filterMode: number): boolean =>
    filterMode === FilterMode.Modulate || filterMode === FilterMode.Modulate2x;

export const getWar3FilterDrawRank = (filterMode: number): number => {
    if (filterMode === FilterMode.Modulate || filterMode === FilterMode.Modulate2x) return 0;
    if (filterMode === FilterMode.Additive) return 2;
    return 1;
};

export const mapParticleEmitter2FilterMode = (filterMode: number): FilterMode => {
    switch (filterMode) {
        case ParticleEmitter2FilterMode.AlphaKey:
            return FilterMode.Transparent;
        case ParticleEmitter2FilterMode.Blend:
            return FilterMode.Blend;
        case ParticleEmitter2FilterMode.Additive:
            return FilterMode.Additive;
        case ParticleEmitter2FilterMode.Modulate:
            return FilterMode.Modulate;
        case ParticleEmitter2FilterMode.Modulate2x:
            return FilterMode.Modulate2x;
        default:
            return FilterMode.Blend;
    }
};

export const getLayerDiscardAlphaLevel = (filterMode: number): number =>
    filterMode === FilterMode.Transparent ? TRANSPARENT_ALPHA_TEST_LEVEL : 0;

export const getParticleDiscardAlphaLevel = (filterMode: number): number => {
    if (filterMode === ParticleEmitter2FilterMode.AlphaKey) return PARTICLE_ALPHA_KEY_TEST_LEVEL;
    if (
        filterMode === ParticleEmitter2FilterMode.Modulate ||
        filterMode === ParticleEmitter2FilterMode.Modulate2x
    ) {
        return MODULATE_ALPHA_TEST_LEVEL;
    }
    return 0;
};

export const applyWar3LayerBlendState = (
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    filterMode: number,
    shading = 0
): void => {
    if (shading & LayerShading.TwoSided) {
        gl.disable(gl.CULL_FACE);
    } else {
        gl.enable(gl.CULL_FACE);
    }

    if (filterMode === FilterMode.None || filterMode === FilterMode.Transparent) {
        gl.disable(gl.BLEND);
        gl.enable(gl.DEPTH_TEST);
        gl.depthMask(true);
    } else if (filterMode === FilterMode.Blend) {
        gl.enable(gl.BLEND);
        gl.enable(gl.DEPTH_TEST);
        gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
    } else if (filterMode === FilterMode.Additive || filterMode === FilterMode.AddAlpha) {
        gl.enable(gl.BLEND);
        gl.enable(gl.DEPTH_TEST);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
        gl.depthMask(false);
    } else if (filterMode === FilterMode.Modulate) {
        gl.enable(gl.BLEND);
        gl.enable(gl.DEPTH_TEST);
        gl.blendFuncSeparate(gl.ZERO, gl.SRC_COLOR, gl.ZERO, gl.ONE);
        gl.depthMask(false);
    } else if (filterMode === FilterMode.Modulate2x) {
        gl.enable(gl.BLEND);
        gl.enable(gl.DEPTH_TEST);
        gl.blendFuncSeparate(gl.DST_COLOR, gl.SRC_COLOR, gl.ZERO, gl.ONE);
        gl.depthMask(false);
    }

    if (shading & LayerShading.NoDepthTest) {
        gl.disable(gl.DEPTH_TEST);
    }
    if (shading & LayerShading.NoDepthSet) {
        gl.depthMask(false);
    }
};

export const applyWar3ParticleBlendState = (
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    filterMode: number
): void => {
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(false);

    if (filterMode === ParticleEmitter2FilterMode.Additive) {
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    } else if (filterMode === ParticleEmitter2FilterMode.Modulate) {
        gl.blendFuncSeparate(gl.ZERO, gl.SRC_COLOR, gl.ZERO, gl.ONE);
    } else if (filterMode === ParticleEmitter2FilterMode.Modulate2x) {
        gl.blendFuncSeparate(gl.DST_COLOR, gl.SRC_COLOR, gl.ZERO, gl.ONE);
    } else {
        gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }
};
