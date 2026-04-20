export type ModelSerializationFormat = 'mdl' | 'mdx'

export interface ModelSerializationGateway {
    parse(buffer: ArrayBuffer, filePath: string): unknown
    serialize(modelData: unknown, format: ModelSerializationFormat): Uint8Array
}
