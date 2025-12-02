const fs = require('fs');
const { parseMDX } = require('./node_modules/war3-model');

const data = fs.readFileSync('D:/Desktop/war3modelview/war3-model-editor/test_model/E15 (120).mdx');
const model = parseMDX(data.buffer);

console.log('=== Sequences ===');
if (model.Sequences && model.Sequences.length > 0) {
    model.Sequences.forEach((seq, i) => {
        console.log(`Sequence ${i}: ${seq.Name}`);
        console.log(`  Interval: [${seq.Interval[0]}, ${seq.Interval[1]}]`);
        console.log(`  NonLooping: ${seq.NonLooping}`);
    });
} else {
    console.log('No sequences found');
}

console.log('\n=== Material Alpha Keys ===');
model.Materials.forEach((mat, mi) => {
    console.log(`Material ${mi}:`);
    mat.Layers.forEach((layer, li) => {
        console.log(`  Layer ${li} FilterMode: ${layer.FilterMode}`);
        if (layer.Alpha && typeof layer.Alpha === 'object' && layer.Alpha.Keys) {
            console.log(`    Alpha Keys:`);
            layer.Alpha.Keys.forEach(key => {
                console.log(`      Frame ${key.Frame}: ${key.Vector[0]}`);
            });
        } else if (typeof layer.Alpha === 'number') {
            console.log(`    Alpha: ${layer.Alpha} (static)`);
        } else {
            console.log(`    Alpha: not set or 1.0 (default)`);
        }
    });
});
