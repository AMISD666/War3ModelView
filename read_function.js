const fs = require('fs');
const path = 'node_modules/war3-model/dist/es/war3-model.mjs';

const content = fs.readFileSync(path, 'utf8');
const start = content.indexOf('setLayerProps(layer, textureID) {');
const end = content.indexOf('setLayerPropsHD', start);

console.log(content.substring(start, end));
