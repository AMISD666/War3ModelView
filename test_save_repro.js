const fs = require('fs');
const { generateMDX, parseMDX } = require('../war3-model-4.0.0');

// Mock model data
const mockModel = {
    Version: 800,
    Info: {
        Name: "TestModel",
        MinimumExtent: new Float32Array([-100, -100, -100]),
        MaximumExtent: new Float32Array([100, 100, 100]),
        BoundsRadius: 100,
        BlendTime: 150
    },
    Sequences: [
        {
            Name: "Seq_Large",
            Interval: new Uint32Array([100000, 200000]),
            MoveSpeed: 0,
            NonLooping: false,
            Rarity: 0,
            MinimumExtent: new Float32Array([-100, -100, -100]),
            MaximumExtent: new Float32Array([100, 100, 100]),
            BoundsRadius: 100
        },
        {
            Name: "Seq_Small",
            Interval: new Uint32Array([0, 1000]),
            MoveSpeed: 100,
            NonLooping: false,
            Rarity: 0,
            MinimumExtent: new Float32Array([-100, -100, -100]),
            MaximumExtent: new Float32Array([100, 100, 100]),
            BoundsRadius: 100
        }
    ],
    Materials: [],
    Textures: [],
    Geosets: [],
    GeosetAnims: [],
    Bones: [],
    Helpers: [],
    Attachments: [],
    PivotPoints: [],
    ParticleEmitters: [],
    ParticleEmitters2: [],
    RibbonEmitters: [],
    Cameras: [],
    Lights: [],
    EventObjects: [],
    CollisionShapes: []
};

try {
    console.log("Generating MDX...");
    const buffer = generateMDX(mockModel);
    console.log("MDX generated, size:", buffer.byteLength);

    console.log("Parsing generated MDX...");
    const parsedModel = parseMDX(buffer);

    console.log("Verifying Sequences...");
    let corrupted = false;
    parsedModel.Sequences.forEach((seq, i) => {
        const original = mockModel.Sequences[i];
        console.log(`\nSequence ${i}: ${seq.Name}`);
        console.log(`Original Interval: [${original.Interval[0]}, ${original.Interval[1]}]`);
        console.log(`Parsed Interval:   [${seq.Interval[0]}, ${seq.Interval[1]}]`);

        if (seq.Interval[0] !== original.Interval[0] || seq.Interval[1] !== original.Interval[1]) {
            console.error("MISMATCH DETECTED!");
            corrupted = true;
        }
    });

    if (corrupted) {
        console.log("\n[FAIL] Sequence Interval corruption detected.");
    } else {
        console.log("\n[PASS] No corruption detected.");
    }

} catch (e) {
    console.error("Error:", e);
}
