import { useEffect, useRef } from 'react'
import { windowGateway } from '../infrastructure/window'

export interface WindowEventEnvelope<TPayload> {
    payload: TPayload
}

export function useWindowEvent<TPayload>(
    eventName: string,
    handler: (event: WindowEventEnvelope<TPayload>) => void,
    enabled = true
): void {
    const handlerRef = useRef(handler)

    useEffect(() => {
        handlerRef.current = handler
    }, [handler])

    useEffect(() => {
        if (!enabled) return

        let disposed = false
        let unlisten: (() => void) | null = null

        void windowGateway.listen(eventName, (event) => {
            handlerRef.current(event as WindowEventEnvelope<TPayload>)
        }).then((nextUnlisten) => {
            if (disposed) {
                nextUnlisten()
                return
            }
            unlisten = nextUnlisten
        })

        return () => {
            disposed = true
            unlisten?.()
        }
    }, [enabled, eventName])
}
