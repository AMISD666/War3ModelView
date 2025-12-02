const fs = require('fs');
const path = 'node_modules/war3-model/dist/es/war3-model.mjs';

if (!fs.existsSync(path)) {
    console.error('File not found:', path);
    process.exit(1);
}

let content = fs.readFileSync(path, 'utf8');

// The incorrect sequence introduced by revert_patch_force.js
const badSequence = `    } else {
      this.gl.uniform1f(this.shaderProgramLocations.discardAlphaLevelUniform, 0);
    }
  }
    if (layer.FilterMode === FilterMode.None) {`;

// The correct sequence (removing the extra '  }')
const correctSequence = `    } else {
      this.gl.uniform1f(this.shaderProgramLocations.discardAlphaLevelUniform, 0);
    }
    if (layer.FilterMode === FilterMode.None) {`;

if (content.includes(badSequence)) {
    content = content.replace(badSequence, correctSequence);
    fs.writeFileSync(path, content);
    console.log('Successfully fixed syntax error in war3-model.mjs');
} else {
    console.error('Could not find the bad sequence. File might be different than expected.');
    // Debug output
    const idx = content.indexOf('this.gl.uniform1f(this.shaderProgramLocations.discardAlphaLevelUniform, 0);');
    if (idx !== -1) {
        console.log('Context around discardAlphaLevelUniform:');
        console.log(content.substring(idx, idx + 200));
    }
}
