import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tempDir = path.join(repoRoot, '.tmp', 'openable-resource-extensions-check')

const fail = (message) => {
    throw new Error(message)
}

const transpile = async (relativePath, replacements = []) => {
    const sourcePath = path.join(repoRoot, relativePath)
    const source = await import('node:fs/promises').then(({ readFile }) => readFile(sourcePath, 'utf8'))
    let output = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.ES2022,
            target: ts.ScriptTarget.ES2022,
        },
    }).outputText
    for (const [from, to] of replacements) {
        output = output.replace(from, to)
    }
    const outputPath = path.join(tempDir, path.basename(relativePath).replace(/\.ts$/, '.mjs'))
    await writeFile(outputPath, output)
    return outputPath
}

await rm(tempDir, { recursive: true, force: true })
await mkdir(tempDir, { recursive: true })

const workflowPath = await transpile('src/renderer/src/application/model-open/OpenModelWorkflow.ts', [
    [/import[^;]+desktop[^;]+;\n?/g, ''],
    [/import[^;]+window[^;]+;\n?/g, ''],
    [/import[^;]+historyService[^;]+;\n?/g, ''],
    [/import[^;]+modelStore[^;]+;\n?/g, ''],
    [/import[^;]+selectionStore[^;]+;\n?/g, ''],
    [/import[^;]+types\/model[^;]+;\n?/g, ''],
    [/export const openModelWorkflow = new OpenModelWorkflow\([^)]*\)\s*;?/g, ''],
])
const { OpenModelWorkflow, DEFAULT_IMPORT_FILE_DIALOG_OPTIONS } = await import(pathToFileURL(workflowPath))

const workflow = new OpenModelWorkflow({}, {})
if (!workflow.isOpenableModelFile('D:/fixture/model.mdx')) {
    fail('Expected .mdx to remain an openable model file')
}
if (workflow.isOpenableModelFile('D:/fixture/texture.png')) {
    fail('PNG should not be treated as an openable model file for retarget/model-only paths')
}
if (!workflow.isOpenableResourceFile('D:/fixture/texture.png')) {
    fail('Expected PNG to be accepted as an openable resource file')
}
if (!workflow.isOpenableResourceFile('D:/fixture/texture.webp')) {
    fail('Expected browser image formats to be accepted as openable resource files')
}

const extensions = DEFAULT_IMPORT_FILE_DIALOG_OPTIONS.filters?.[0]?.extensions ?? []
for (const expected of ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp']) {
    if (!extensions.includes(expected)) {
        fail(`Expected open dialog filter to include .${expected}`)
    }
}

console.log('OK openable resource filters accept browser images while model-only paths stay model-only.')
