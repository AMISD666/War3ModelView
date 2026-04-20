import { generateMDL, generateMDX, parseMDL, parseMDX } from 'war3-model'
import type { ModelSerializationFormat, ModelSerializationGateway } from './ModelSerializationGateway'

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

export class War3ModelSerializationGateway implements ModelSerializationGateway {
    parse(buffer: ArrayBuffer, filePath: string): unknown {
        const ext = filePath.toLowerCase().split('.').pop()
        if (ext === 'mdl') {
            return parseMDL(textDecoder.decode(buffer))
        }

        return parseMDX(buffer)
    }

    serialize(modelData: unknown, format: ModelSerializationFormat): Uint8Array {
        if (format === 'mdl') {
            return textEncoder.encode(generateMDL(modelData as never))
        }

        return new Uint8Array(generateMDX(modelData as never))
    }
}

export const modelSerializationGateway: ModelSerializationGateway = new War3ModelSerializationGateway()
