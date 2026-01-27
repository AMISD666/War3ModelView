
const fs = require('fs');

function analyze(filePath) {
    const buffer = fs.readFileSync(filePath);
    const nodes = [];
    const pivotPoints = [];

    // Find chunks
    let pos = 4; // Skip MDLX
    while (pos < buffer.length - 8) {
        const tag = buffer.slice(pos, pos + 4).toString();
        const size = buffer.readUint32LE(pos + 4);
        pos += 8;
        const end = pos + size;

        if (['BONE', 'HELP', 'ATCH', 'PREM', 'PRE2', 'RIBB', 'EVTS', 'CLID'].includes(tag)) {
            let chunkPos = pos;
            while (chunkPos < end) {
                const nodeSize = buffer.readUint32LE(chunkPos);
                const name = buffer.slice(chunkPos + 4, chunkPos + 4 + 80).toString().replace(/\0/g, '');
                const id = buffer.readUint32LE(chunkPos + 4 + 80);
                const parent = buffer.readInt32LE(chunkPos + 4 + 80 + 4);
                nodes.push({ tag, name, id, parent, globalIndex: nodes.length });
                chunkPos += nodeSize;
            }
        } else if (tag === 'PIVT') {
            for (let i = 0; i < size / 12; i++) {
                pivotPoints.push([
                    buffer.readFloatLE(pos + i * 12),
                    buffer.readFloatLE(pos + i * 12 + 4),
                    buffer.readFloatLE(pos + i * 12 + 8)
                ]);
            }
        }
        pos = end;
    }
    return { nodes, pivotPoints };
}

const orig = analyze('D:\\Desktop\\war3modelview\\War3ModelView\\testmodel\\SX-yumo2.mdx');
const mod = analyze('D:\\Desktop\\war3modelview\\War3ModelView\\testmodel\\033.mdx');

console.log(`Original: ${orig.nodes.length} nodes, ${orig.pivotPoints.length} pivots`);
console.log(`Modified: ${mod.nodes.length} nodes, ${mod.pivotPoints.length} pivots`);

// Compare node order
console.log('\n--- Node Order Comparison ---');
for (let i = 0; i < Math.min(20, orig.nodes.length, mod.nodes.length); i++) {
    const o = orig.nodes[i];
    const m = mod.nodes[i];
    console.log(`${i.toString().padStart(3)} | Orig: ${o.tag.padEnd(4)} "${o.name.substring(0, 10)}" ID=${o.id} P=${o.parent} | Mod: ${m.tag.padEnd(4)} "${m.name.substring(0, 10)}" ID=${m.id} P=${m.parent}`);
}

// Check for broken parents
console.log('\n--- Broken Parents in Modified ---');
mod.nodes.forEach((n, i) => {
    if (n.parent !== -1 && (n.parent >= mod.nodes.length || n.parent < 0)) {
        console.log(`Node ${i} has INVALID parent index ${n.parent}`);
    } else if (n.parent !== -1 && n.parent > i) {
        // console.log(`Node ${i} has Forward Parent ${n.parent} (Potential issue for some engines)`);
    }
});

// Compare pivot point for a specific node name
const targetName = mod.nodes.find(n => n.tag === 'PRE2')?.name;
if (targetName) {
    const oNode = orig.nodes.find(n => n.name === targetName);
    const mNode = mod.nodes.find(n => n.name === targetName);
    if (oNode && mNode) {
        console.log(`\n--- Pivot Compare for "${targetName}" ---`);
        console.log(`Original: Index=${oNode.globalIndex}, Pivot=[${orig.pivotPoints[oNode.globalIndex]}]`);
        console.log(`Modified: Index=${mNode.globalIndex}, Pivot=[${mod.pivotPoints[mNode.globalIndex]}]`);
    }
}
