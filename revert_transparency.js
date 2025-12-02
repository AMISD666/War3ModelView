const fs = require('fs');
const path = 'node_modules/war3-model/dist/es/war3-model.mjs';

try {
    if (!fs.existsSync(path)) {
        console.error('Target file not found:', path);
        process.exit(1);
    }

    let content = fs.readFileSync(path, 'utf8');
    let modified = false;

    // Revert Patch 1: Change discardAlphaLevel from 0.05 back to 0.75
    const discardRegex = /(this\.gl\.uniform1f\(this\.shaderProgramLocations\.discardAlphaLevelUniform,\s*)0\.05(\);)/g;

    if (discardRegex.test(content)) {
        content = content.replace(discardRegex, '$10.75$2');
        modified = true;
        console.log('Successfully reverted discardAlphaLevel from 0.05 to 0.75.');
    } else {
        console.warn('Could not find discardAlphaLevel logic to revert (might have been already reverted).');
    }

    // Revert Patch 2: Change depthMask(false) back to depthMask(true) for Transparent mode
    // We look for the block:
    // } else if (layer.FilterMode === FilterMode.Transparent) {
    // ...
    // this.gl.depthMask(false);

    const depthMaskRegex = /(FilterMode\.Transparent\)\s*\{[\s\S]*?this\.gl\.depthMask\()false(\);)/g;

    let matchCount = 0;
    content = content.replace(depthMaskRegex, (match, p1, p2) => {
        matchCount++;
        return p1 + 'true' + p2;
    });

    if (matchCount > 0) {
        modified = true;
        console.log(`Successfully reverted depthMask(false) to depthMask(true) in ${matchCount} locations.`);
    } else {
        console.warn('Could not find Transparent mode depthMask(false) logic to revert.');
    }

    if (modified) {
        fs.writeFileSync(path, content);
        console.log('Revert applied successfully to war3-model.mjs');
    } else {
        console.log('No changes needed or revert failed to find targets.');
    }

} catch (e) {
    console.error('Error applying revert:', e);
    process.exit(1);
}
