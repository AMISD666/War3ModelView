const { generateMDX, parseMDX } = require('../war3-model-4.0.0');

// 1. Logic extracted from MainLayout.tsx
function prepareModelDataForSave(modelData) {
    if (!modelData) return modelData;

    // Simulate structuredClone if needed, but for simple object here we just use it directly or simple copy
    let data = { ...modelData };

    const toUint32Array = (arr) => {
        if (arr instanceof Uint32Array) return arr;
        if (Array.isArray(arr)) return new Uint32Array(arr);
        if (arr && typeof arr === 'object') {
            const values = Object.values(arr).map(Number);
            return new Uint32Array(values);
        }
        return new Uint32Array([0, 0]);
    };

    const toFloat32Array = (arr, size = 3) => {
        if (arr instanceof Float32Array) return arr;
        if (Array.isArray(arr)) return new Float32Array(arr);
        if (arr && typeof arr === 'object') {
            const values = Object.values(arr).map(Number);
            return new Float32Array(values);
        }
        return new Float32Array(size);
    };

    // Fix Sequences
    if (data.Sequences && Array.isArray(data.Sequences)) {
        console.log(`[Prep] Processing ${data.Sequences.length} sequences`);
        data.Sequences.forEach((seq, index) => {
            const intervalType = seq.Interval ? (seq.Interval instanceof Uint32Array ? 'Uint32Array' : Array.isArray(seq.Interval) ? 'Array' : typeof seq.Interval) : 'undefined';
            console.log(`[Prep] Sequence ${index} Interval type: ${intervalType}`);

            if (seq.Interval && !(seq.Interval instanceof Uint32Array)) {
                seq.Interval = toUint32Array(seq.Interval);
                console.log(`[Prep] -> Converted to Uint32Array: [${seq.Interval[0]}, ${seq.Interval[1]}]`);
            }
            // Minimal other conversions for this test
        });
    }

    return data;
}

// 2. Mock Data with Regular Arrays (Simulation of UI State)
const mockModelUIState = {
    Version: 800,
    Info: {
        Name: "TestInterval",
        MinimumExtent: [-100, -100, -100], // Float32Array expected but UI might give Array
        MaximumExtent: [100, 100, 100],
        BoundsRadius: 100,
        BlendTime: 150
    },
    Sequences: [
        {
            Name: "Stand",
            Interval: [333, 666], // Regular Array!
            MoveSpeed: 0,
            NonLooping: false,
            Rarity: 0,
            MinimumExtent: [-10, -10, -10],
            MaximumExtent: [10, 10, 10],
            BoundsRadius: 10
        },
        {
            Name: "Walk",
            Interval: [1000, 2000],
            MoveSpeed: 100,
            NonLooping: false,
            Rarity: 0,
            MinimumExtent: [-10, -10, -10],
            MaximumExtent: [10, 10, 10],
            BoundsRadius: 10
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

// 3. Execution Phase
try {
    console.log("=== Starting Test: MDX Save Logic Verification ===");

    // Step A: Prepare Data
    console.log("Step A: Preparing Model Data...");
    const preparedData = prepareModelDataForSave(mockModelUIState);

    // Verify preparation
    const seq0 = preparedData.Sequences[0];
    if (seq0.Interval instanceof Uint32Array) {
        console.log("[PASS] Sequence 0 Interval is now Uint32Array");
    } else {
        console.error("[FAIL] Sequence 0 Interval is NOT Uint32Array");
    }

    // Step B: Generate MDX
    console.log("Step B: Generating MDX...");
    const buffer = generateMDX(preparedData);
    console.log(`Generated buffer size: ${buffer.byteLength} bytes`);

    // Step C: Parse Generated MDX
    console.log("Step C: Parsing Generated MDX...");
    const parsedModel = parseMDX(buffer);

    // Step D: Verify Values
    console.log("Step D: Verifying Values...");
    let passed = true;

    const s0 = parsedModel.Sequences[0];
    if (s0.Interval[0] === 333 && s0.Interval[1] === 666) {
        console.log(`[PASS] Sequence 0 Interval matches: [${s0.Interval[0]}, ${s0.Interval[1]}]`);
    } else {
        console.error(`[FAIL] Sequence 0 Interval MISMATCH: Expected [333, 666], Got [${s0.Interval[0]}, ${s0.Interval[1]}]`);
        passed = false;
    }

    const s1 = parsedModel.Sequences[1];
    if (s1.Interval[0] === 1000 && s1.Interval[1] === 2000) {
        console.log(`[PASS] Sequence 1 Interval matches: [${s1.Interval[0]}, ${s1.Interval[1]}]`);
    } else {
        console.error(`[FAIL] Sequence 1 Interval MISMATCH: Expected [1000, 2000], Got [${s1.Interval[0]}, ${s1.Interval[1]}]`);
        passed = false;
    }

    if (passed) {
        console.log("\n>>> VERIFICATION SUCCESSFUL: Save logic correctly handles array conversion.");
    } else {
        console.log("\n>>> VERIFICATION FAILED: Corruption detected.");
    }

} catch (e) {
    console.error("Test Exception:", e);
}
