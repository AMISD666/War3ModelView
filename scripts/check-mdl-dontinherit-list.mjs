import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import * as esbuild from 'esbuild'

const repoRoot = path.resolve(import.meta.dirname, '..')
const fixturePath = path.join(repoRoot, 'testmodel', 'tx_053_s03_2_03_skin10_zhibao1.mdl')
const distPath = fs.mkdtempSync(path.join(os.tmpdir(), 'war3modelview-mdl-dontinherit-check-'))
const bundlePath = path.join(distPath, 'mdl-dontinherit-check-bundle.mjs')
const dontInheritAll = 1 | 2 | 4

const fail = (message) => {
    throw new Error(message)
}

await esbuild.build({
    stdin: {
        contents: [
            "export { parse as parseMDL } from './vendor/war3-model/mdl/parse.ts'",
            "export { generate as generateMDL } from './vendor/war3-model/mdl/generate.ts'",
        ].join('\n'),
        resolveDir: repoRoot,
        sourcefile: 'mdl-dontinherit-check-entry.ts',
        loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: bundlePath,
    tsconfig: path.join(repoRoot, 'tsconfig.web.json'),
    logLevel: 'silent',
})

const { parseMDL, generateMDL } = await import(pathToFileURL(bundlePath).href)
const text = fs.readFileSync(fixturePath, 'utf8')
const model = parseMDL(text)
const bip001 = model.Nodes?.find((node) => node?.Name === 'Bip001')

if (!bip001) {
    fail(`Missing Bip001 after parsing ${fixturePath}`)
}

if ((bip001.Flags & dontInheritAll) !== dontInheritAll) {
    fail(`Bip001 DontInherit flags were not preserved, got Flags=${bip001.Flags}`)
}

const generatedText = generateMDL(model)
const reparsed = parseMDL(generatedText)
const reparsedBip001 = reparsed.Nodes?.find((node) => node?.Name === 'Bip001')

if ((reparsedBip001?.Flags & dontInheritAll) !== dontInheritAll) {
    fail(`Generated MDL did not round-trip Bip001 DontInherit flags, got Flags=${reparsedBip001?.Flags}`)
}

console.log('MDL DontInherit list parse check passed')
