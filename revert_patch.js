const fs = require('fs');
const path = 'node_modules/war3-model/dist/es/war3-model.mjs';

if (!fs.existsSync(path)) {
    console.error('File not found:', path);
    process.exit(1);
}

let content = fs.readFileSync(path, 'utf8');

// The function added by the patch
const patchedFunc = `setLayerProps(layer, textureID) {
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
    }
    }`;

// The original function to restore
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

// We need to be careful with whitespace matching. 
// The patch script used specific indentation.
// Let's try to find the patched version and replace it.

// Normalize strings to ignore potential whitespace differences if needed, 
// but simple string replacement is safest if we match exactly what we wrote.

if (content.includes('// PATCH: Handle layer alpha')) {
    // It seems the file is patched.
    // We can try to replace the whole block.
    // However, exact string matching might fail if indentation was changed by editor formatting.
    // Let's try a regex approach or just look for the markers.

    const startMarker = 'setLayerProps(layer, textureID) {';
    const endMarker = 'this.gl.uniform1f(this.shaderProgramLocations.discardAlphaLevelUniform, 0);\n    }';

    // Construct the exact string we expect to find
    // We'll use the string defined above, but we need to ensure it matches the file.
    // Let's read the file and check.

    // Actually, since we wrote it with `apply_patch.js`, it should match `replacementFunc` from that file.
    // Let's try direct replacement first.

    // Remove the extra indentation from the string literals above to match file?
    // In apply_patch.js, we wrote it with 4 spaces for the body.

    // Let's try to find the patched function by a unique substring
    const uniquePatchString = '// PATCH: Handle layer alpha';

    if (content.indexOf(uniquePatchString) !== -1) {
        // Find start of function
        const startIndex = content.lastIndexOf('setLayerProps(layer, textureID) {', content.indexOf(uniquePatchString));

        if (startIndex !== -1) {
            // Find end of function (counting braces is safer, but let's assume standard formatting)
            // The patched function ends with `}` after the else block.
            // It has `this.gl.uniform1f(this.shaderProgramLocations.discardAlphaLevelUniform, 0);` then `}`.

            // Let's just use the `replacementFunc` string from apply_patch.js logic.
            // I'll copy it exactly here.
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
    }
    }`;

            if (content.includes(replacementFunc)) {
                content = content.replace(replacementFunc, originalFunc);
                fs.writeFileSync(path, content);
                console.log('Successfully reverted war3-model.mjs to original state.');
            } else {
                console.log('Could not find exact match for patched function. Trying looser replacement...');
                // Fallback: Replace by finding the range
                // This is risky without precise parsing.
                // Let's try to just replace the inner body if we can identify it.
                console.error('Failed to revert: Content mismatch.');
            }
        }
    } else {
        console.log('File does not appear to contain the patch.');
    }
} else {
    console.log('File does not appear to contain the patch (marker not found).');
}
