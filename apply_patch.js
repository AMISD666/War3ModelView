const fs = require('fs');
const path = 'node_modules/war3-model/dist/es/war3-model.mjs';

let content = fs.readFileSync(path, 'utf8');

// Note: The indentation in the file uses 2 spaces based on previous output
const targetFunc = `setLayerProps(layer, textureID) {
    const texture = this.rendererData.model.Textures[textureID];
    if (layer.Shading & LayerShading.TwoSided) {
      this.gl.disable(this.gl.CULL_FACE);
    } else {
      this.gl.enable(this.gl.CULL_FACE);
    }
    if (layer.FilterMode === FilterMode.Transparent) {
      this.gl.uniform1f(this.shaderProgramLocations.discardAlphaLevelUniform, 0.75);
    } else {
      this.gl.uniform1f(this.shaderProgramLocations.discardAlphaLevelUniform, 0);
    }`;

const replacementFunc = `setLayerProps(layer, textureID) {
    const texture = this.rendererData.model.Textures[textureID];
    
    // PATCH: Handle layer alpha
    let layerAlpha = 1.0;
    if (layer.Alpha !== undefined && layer.Alpha !== null) {
        if (typeof layer.Alpha === 'number') {
            layerAlpha = layer.Alpha;
        } else {
            const alphaValue = this.interp.num(layer.Alpha);
            if (alphaValue !== null) {
                layerAlpha = alphaValue;
            }
        }
    }

    if (layer.Shading & LayerShading.TwoSided) {
      this.gl.disable(this.gl.CULL_FACE);
    } else {
      this.gl.enable(this.gl.CULL_FACE);
    }
    
    // PATCH: Discard if alpha is too low
    if (layerAlpha < 0.05) {
      this.gl.uniform1f(this.shaderProgramLocations.discardAlphaLevelUniform, 2.0);
    } else if (layer.FilterMode === FilterMode.Transparent) {
      this.gl.uniform1f(this.shaderProgramLocations.discardAlphaLevelUniform, 0.75);
    } else {
      this.gl.uniform1f(this.shaderProgramLocations.discardAlphaLevelUniform, 0);
    }`;

if (content.includes(targetFunc)) {
    content = content.replace(targetFunc, replacementFunc);
    fs.writeFileSync(path, content);
    console.log('Successfully patched war3-model.mjs');
} else {
    console.error('Target function not found!');
    // Try to debug why
    const idx = content.indexOf('setLayerProps(layer, textureID)');
    if (idx !== -1) {
        console.log('Found function start, but body mismatch.');
        console.log('Actual content:');
        console.log(content.substring(idx, idx + 400));
    }
}
