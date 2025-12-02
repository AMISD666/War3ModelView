const fs = require('fs');
const { parseMDX } = require('./node_modules/war3-model');

const data = fs.readFileSync('D:/Desktop/war3modelview/war3-model-editor/test_model/E15 (120).mdx');
const model = parseMDX(data.buffer);

console.log('=== Manual Alpha Interpolation Test ===\n');

// Get Material 0, Layer 0
const layer0 = model.Materials[0].Layers[0];
const alphaAnim = layer0.Alpha;

console.log('Layer 0 Alpha Animation:');
console.log(`  Keys: ${alphaAnim.Keys.length}`);
alphaAnim.Keys.forEach((key, i) => {
    console.log(`  Key ${i}: Frame=${key.Frame}, Value=${key.Vector[0]}`);
});

// Simulate findKeyframes logic
const testFrames = [0, 100, 333, 667, 3999, 4000, 4100];
const from = 0;    // Stand animation start
const to = 667;    // Stand animation end

console.log(`\nAnimation Range: [${from}, ${to}]`);
console.log('\n=== Simulating findKeyframes logic ===\n');

testFrames.forEach(frame => {
    console.log(`Testing frame ${frame}:`);

    const array = alphaAnim.Keys;

    // Check from interp.ts lines 50-54
    if (array[0].Frame > to) {
        console.log(`  -> Returns null (first keyframe ${array[0].Frame} > animation end ${to})`);
        console.log(`  -> Result: Alpha defaults to 1.0\n`);
        return;
    } else if (array[array.length - 1].Frame < from) {
        console.log(`  -> Returns null (last keyframe < animation start)`);
        console.log(`  -> Result: Alpha defaults to 1.0\n`);
        return;
    }

    // Binary search would continue here...
    // But the key insight is above: first keyframe is 4000, animation end is 667
    // So array[0].Frame (4000) > to (667) should return null!

    console.log(`  -> First keyframe is at ${array[0].Frame}`);
    console.log(`  -> This should show up!\n`);
});
