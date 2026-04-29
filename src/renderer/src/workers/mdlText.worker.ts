import { generateMDL, parseMDL } from 'war3-model'
import {
    parseMdlWithNumericRecovery,
    sanitizeModelNumericValuesForSerialization,
} from '../infrastructure/serialization/mdlNumericSanitizer'

type GenerateRequest = {
    type: 'generate'
    requestId: number
    modelData: any
}

type ParseRequest = {
    type: 'parse'
    requestId: number
    text: string
}

type WorkerRequest = GenerateRequest | ParseRequest

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
    const payload = event.data

    try {
        if (payload.type === 'generate') {
            const text = generateMDL(sanitizeModelNumericValuesForSerialization(payload.modelData))
            self.postMessage({
                type: 'generate-success',
                requestId: payload.requestId,
                text
            })
            return
        }

        if (payload.type === 'parse') {
            const model = parseMdlWithNumericRecovery(payload.text, parseMDL)
            self.postMessage({
                type: 'parse-success',
                requestId: payload.requestId,
                model
            })
        }
    } catch (error) {
        self.postMessage({
            type: 'error',
            requestId: payload.requestId,
            error: error instanceof Error ? error.message : String(error)
        })
    }
}
