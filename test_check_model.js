const fs = require('fs');
const { parseMDX } = require('./node_modules/war3-model');

const data = fs.readFileSync('D:/Desktop/war3modelview/war3-model-editor/test_model/E15 (120).mdx');
const model = parseMDX(data.buffer);

console.log('=== Model Info ===');
console.log('Materials count:', model.Materials?.length || 0);
console.log('Textures count:', model.Textures?.length || 0);
console.log('Geosets count:', model.Geosets?.length || 0);

if (model.Materials && model.Materials.length > 0) {
    console.log('\n=== First Material ===');
    const mat = model.Materials[0];
    console.log('Material:', JSON.stringify(mat, null, 2));
}

if (model.Textures && model.Textures.length > 0) {
    console.log('\n=== Textures ===');
    model.Textures.forEach((tex, i) => {
        console.log(`Texture ${i}:`, JSON.stringify(tex, null, 2));
    });
}
