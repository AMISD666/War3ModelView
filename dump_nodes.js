
const fs = require('fs');

function analyze(filePath) {
    const buffer = fs.readFileSync(filePath);
    const nodeTypes = [];
    let pos = 4;
    while (pos < buffer.length - 8) {
        const tag = buffer.slice(pos, pos + 4).toString();
        const size = buffer.readUint32LE(pos + 4);
        pos += 8;
        const end = pos + size;
        if (['BONE', 'HELP', 'ATCH', 'PREM', 'PRE2', 'RIBB', 'EVTS', 'CLID'].includes(tag)) {
            let cp = pos;
            while (cp < end) {
                const ns = buffer.readUint32LE(cp);
                const parent = buffer.readInt32LE(cp + 4 + 80 + 4);
                nodeTypes.push({ tag, parent, index: nodeTypes.length });
                cp += ns;
            }
        }
        pos = end;
    }
    return nodeTypes;
}

const originalNodes = analyze('D:\\Desktop\\war3modelview\\War3ModelView\\testmodel\\SX-yumo2.mdx');
const modifiedNodes = analyze('D:\\Desktop\\war3modelview\\War3ModelView\\testmodel\\033.mdx');

console.log('--- SX-yumo2.mdx Node Order and Parent indices ---');
originalNodes.slice(0, 50).forEach(n => {
    console.log(`${n.index.toString().padStart(3)}: Type=${n.tag} Parent=${n.parent}`);
});

console.log('\n--- 033.mdx Node Order and Parent indices ---');
modifiedNodes.slice(0, 50).forEach(n => {
    console.log(`${n.index.toString().padStart(3)}: Type=${n.tag} Parent=${n.parent}`);
});
