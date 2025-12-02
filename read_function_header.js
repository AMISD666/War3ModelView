const fs = require('fs');
const path = 'node_modules/war3-model/dist/es/war3-model.mjs';

const content = fs.readFileSync(path, 'utf8');
const start = content.indexOf('setLayerProps(layer, textureID) {');
if (start === -1) {
    console.log('Function not found');
} else {
    console.log(content.substring(start, start + 300));
}
