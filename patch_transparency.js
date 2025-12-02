const fs = require('fs');
const path = 'node_modules/war3-model/dist/es/war3-model.mjs';

try {
    if (!fs.existsSync(path)) {
        console.error('Target file not found:', path);
        process.exit(1);
    }

    let content = fs.readFileSync(path, 'utf8');
    let modified = false;

    // Patch 1: Change discardAlphaLevel from 0.75 to 0.05 (or 0.01)
    // We target the specific assignment in the Transparent block
    // this.gl.uniform1f(this.shaderProgramLocations.discardAlphaLevelUniform, 0.75);
    const discardRegex = /(this\.gl\.uniform1f\(this\.shaderProgramLocations\.discardAlphaLevelUniform,\s*)0\.75(\);)/g;

    if (discardRegex.test(content)) {
        content = content.replace(discardRegex, '$10.05$2');
        modified = true;
        console.log('Successfully patched discardAlphaLevel from 0.75 to 0.05.');
    } else {
        console.warn('Could not find discardAlphaLevel logic to patch (might have been already patched).');
    }

    // Patch 2: Change depthMask(true) to depthMask(false) for Transparent mode
    // We look for the block:
    // } else if (layer.FilterMode === FilterMode.Transparent) {
    // ...
    // this.gl.depthMask(true);

    // Regex explanation:
    // (FilterMode\.Transparent\)\s*\{[\s\S]*?this\.gl\.depthMask\()   -> Group 1: Match start of block up to depthMask call
    // true                                                             -> Match 'true'
    // (\);)                                                            -> Group 2: Match closing parenthesis and semicolon

    // Note: We use [\s\S]*? to match across newlines non-greedily.
    // We need to be careful not to match too much.
    // The structure is roughly:
    // else if (layer.FilterMode === FilterMode.Transparent) { ... this.gl.depthMask(true); }

    const depthMaskRegex = /(FilterMode\.Transparent\)\s*\{[\s\S]*?this\.gl\.depthMask\()true(\);)/g;

    let matchCount = 0;
    content = content.replace(depthMaskRegex, (match, p1, p2) => {
        matchCount++;
        return p1 + 'false' + p2;
    });

    if (matchCount > 0) {
        modified = true;
        console.log(`Successfully patched depthMask(true) to depthMask(false) in ${matchCount} locations.`);
    } else {
        console.warn('Could not find Transparent mode depthMask(true) logic to patch.');
        // Debug: print a snippet if we can find FilterMode.Transparent
        const idx = content.indexOf('FilterMode.Transparent');
        if (idx !== -1) {
            console.log('Snippet around FilterMode.Transparent:');
            console.log(content.substring(idx, idx + 300));
        }
    }

    if (modified) {
        fs.writeFileSync(path, content);
        console.log('Patch applied successfully to war3-model.mjs');
    } else {
        console.log('No changes needed or patch failed to find targets.');
    }

} catch (e) {
    console.error('Error applying patch:', e);
    process.exit(1);
}
