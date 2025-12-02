const fs = require('fs');
const path = 'node_modules/war3-model/dist/es/war3-model.mjs';

try {
    let content = fs.readFileSync(path, 'utf8');

    // Find the end of setLayerProps function
    // It ends with: this.gl.uniformMatrix3fv(this.shaderProgramLocations.tVertexAnimUniform, false, this.getTexCoordMatrix(layer));
    // followed by }

    const searchString = 'this.gl.uniformMatrix3fv(this.shaderProgramLocations.tVertexAnimUniform, false, this.getTexCoordMatrix(layer));';
    const insertionPoint = content.indexOf(searchString);

    if (insertionPoint === -1) {
        console.error('Could not find setLayerProps function end');
        process.exit(1);
    }

    const endOfLine = content.indexOf('\n', insertionPoint);
    const insertPos = endOfLine + 1; // After the newline

    const codeToInsert = `
    // PATCH: Handle layer alpha animation
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

    if (layerAlpha < 0.99) {
        this.gl.enable(this.gl.BLEND);
        // Use glColor to modulate texture
        // Note: WebGL doesn't have color4f, but we can try uniform if shader supports it
        // Or rely on the fact that fixed pipeline might not exist but we can try to hack it
        // Actually, let's just try to set the blend color constant if that helps? No.
        
        // Wait, we need to pass this to shader.
        // But we can't easily modify shader here.
        // Let's try to use blendColor? No.
        
        // Let's try to use the hack I planned: modify geosetColorUniform?
        // But setLayerProps is called AFTER geosetColorUniform is set in the loop.
        // So we can't modify it here easily without changing the loop.
    }
    `;

    // Wait, modifying setLayerProps alone isn't enough if I can't pass the alpha to the shader.
    // And I can't modify the loop easily because it's minified/compiled.

    // BUT, I can modify the loop in the same file!
    // Let's look for the loop.

} catch (e) {
    console.error(e);
}
