
function normalizePath(p) {
    return p.replace(/\//g, '\\')
}

function getTextureCandidatePaths(modelPath, texturePath) {
    const textureRelPath = normalizePath(texturePath)
    const normalizedModelPath = normalizePath(modelPath)
    const lastSlash = normalizedModelPath.lastIndexOf('\\')
    const modelDir = lastSlash >= 0 ? normalizedModelPath.substring(0, lastSlash) : normalizedModelPath

    const candidates = []

    // Primary: model dir + texture relative path
    candidates.push(`${modelDir}\\${textureRelPath}`)

    // Fallback: just filename in model dir
    const filename = textureRelPath.split('\\').pop() || ''
    if (filename !== textureRelPath) {
        candidates.push(`${modelDir}\\${filename}`)
    }

    // Try parent directories recursively up to root
    let currentDir = modelDir
    while (true) {
        const lastSlash = currentDir.lastIndexOf('\\')
        if (lastSlash === -1) break
        currentDir = currentDir.substring(0, lastSlash)
        if (currentDir === '' || currentDir.endsWith(':')) {
            candidates.push(`${currentDir}\\${textureRelPath}`)
            break
        }
        candidates.push(`${currentDir}\\${textureRelPath}`)
    }

    return Array.from(new Set(candidates))
}

const modelPath = "d:\\Desktop\\war3modelview\\War3ModelView\\testmodel\\CurbStone0.mdx"
const texturePath = "Textures\\YC_CityItems1.blp"
const results = getTextureCandidatePaths(modelPath, texturePath)
console.log("Candidates for " + texturePath + ":")
results.forEach(c => console.log(c))
