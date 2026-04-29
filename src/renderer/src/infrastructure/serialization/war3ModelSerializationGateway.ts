import { generateMDL, generateMDX, parseMDL, parseMDX } from 'war3-model'
import type { ModelSerializationFormat, ModelSerializationGateway } from './ModelSerializationGateway'
import {
    parseMdlWithNumericRecovery,
    sanitizeModelNumericValuesForSerialization,
} from './mdlNumericSanitizer'
import { applyWar3GameMdxExportRules } from './strictMdxExport'

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

export class War3ModelSerializationGateway implements ModelSerializationGateway {
    parse(buffer: ArrayBuffer, filePath: string): unknown {
        const ext = filePath.toLowerCase().split('.').pop()
        if (ext === 'mdl') {
            return parseMdlWithNumericRecovery(textDecoder.decode(buffer), parseMDL)
        }

        return parseMDX(buffer)
    }

    serialize(modelData: unknown, format: ModelSerializationFormat): Uint8Array {
        const sanitizedModelData = sanitizeModelNumericValuesForSerialization(modelData)
        if (format === 'mdl') {
            return textEncoder.encode(generateMDL(sanitizedModelData as never))
        }

        return applyWar3GameMdxExportRules(new Uint8Array(generateMDX(sanitizedModelData as never)))
    }
}

export const modelSerializationGateway: ModelSerializationGateway = new War3ModelSerializationGateway()
