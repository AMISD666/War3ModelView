const fs = require('fs');
const { parseMDX } = require('./node_modules/war3-model');
const { ModelInterp } = require('./node_modules/war3-model/dist/war3-model.browser.js');

const data = fs.readFileSync('D:/Desktop/war3modelview/war3-model-editor/test_model/E15 (120).mdx');
const model = parseMDX(data.buffer);

console.log('=== Testing Layer Alpha Interpolation ===\n');

// Simulate renderer data
const rendererData = {
    model: model,
    frame: 333,  // Middle of Stand animation (0-667)
    animation: 0,
    animationInfo: model.Sequences[0],  // Stand AZ
    globalSequencesFrames: []
};

console.log(`Current Animation: ${rendererData.animationInfo.Name}`);
console.log(`Current Frame: ${rendererData.frame}`);
console.log(`Animation Interval: [${rendererData.animationInfo.Interval[0]}, ${rendererData.animationInfo.Interval[1]}]\n`);

const interp = new ModelInterp(rendererData);

// Test Material 0, Layer 0 Alpha
const material0 = model.Materials[0];
const layer0 = material0.Layers[0];

console.log('Material 0, Layer 0:');
console.log(`  FilterMode: ${layer0.FilterMode}`);
console.log(`  Alpha type: ${typeof layer0.Alpha}`);

if (layer0.Alpha && typeof layer0.Alpha === 'object') {
    console.log(`  Alpha Keys:`);
    layer0.Alpha.Keys.forEach(key => {
        console.log(`    Frame ${key.Frame}: ${key.Vector[0]}`);
    });
    console.log(`  LineType: ${layer0.Alpha.LineType}`);
    console.log(`  GlobalSeqId: ${layer0.Alpha.GlobalSeqId}`);

    // Test interpolation
    console.log('\n  Testing interpolation:');
    const alphaValue = interp.num(layer0.Alpha);
    console.log(`  interp.num() returned: ${alphaValue}`);
    console.log(`  Type: ${typeof alphaValue}`);
    console.log(`  Is null: ${alphaValue === null}`);

    // Test animVectorVal with default
    const withDefault = interp.animVectorVal(layer0.Alpha, 1.0);
    console.log(`  animVectorVal(alpha, 1.0) returned: ${withDefault}`);
}

// Test at different frames
console.log('\n=== Testing at different frames ===');
const testFrames = [0, 100, 333, 667, 4000, 4100];
testFrames.forEach(frame => {
    rendererData.frame = frame;
    const alphaValue = interp.num(layer0.Alpha);
    const withDefault = interp.animVectorVal(layer0.Alpha, 1.0);
    console.log(`Frame ${frame}: interp.num()=${alphaValue}, animVectorVal()=${withDefault}`);
});
