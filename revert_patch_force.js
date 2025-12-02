const fs = require('fs');
const path = 'node_modules/war3-model/dist/es/war3-model.mjs';

if (!fs.existsSync(path)) {
    console.error('File not found:', path);
    process.exit(1);
}

let content = fs.readFileSync(path, 'utf8');

// The patched function string (normalized for potential whitespace issues)
// We will use a regex to match the patched function more flexibly
const patchedRegex = /setLayerProps\(layer, textureID\) \{[\s\S]*?\/\/ PATCH: Handle layer alpha[\s\S]*?\/\/ PATCH: Discard if alpha is too low[\s\S]*?this\.gl\.uniform1f\(this\.shaderProgramLocations\.discardAlphaLevelUniform, 0\);\s*\}/;

const originalFunc = `setLayerProps(layer, textureID) {
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
    }
  }`;

if (patchedRegex.test(content)) {
    content = content.replace(patchedRegex, originalFunc);
    fs.writeFileSync(path, content);
    console.log('Successfully reverted war3-model.mjs to original state.');
} else {
    console.log('Could not find patched function using regex. Checking if already reverted...');
    if (content.includes('// PATCH: Handle layer alpha')) {
        console.error('Patch markers found but regex failed. Manual intervention required.');
    } else {
        console.log('File appears to be clean (no patch markers found).');
    }
}
