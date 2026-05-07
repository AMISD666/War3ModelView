import { normalizeExternalFileDropPath, type ExternalFileDropClaimDetail } from './externalFileDropEvent'

const CLAIM_TTL_MS = 4000

type DropClaimRecord = {
    expiresAt: number
    sourceWindowLabel?: string
}

export class ExternalFileDropClaimRegistry {
    private readonly claims = new Map<string, DropClaimRecord>()

    private cleanup(now = Date.now()): void {
        for (const [path, claim] of this.claims.entries()) {
            if (claim.expiresAt <= now) {
                this.claims.delete(path)
            }
        }
    }

    apply(detail: ExternalFileDropClaimDetail): void {
        const now = Date.now()
        this.cleanup(now)

        const normalizedPaths = Array.from(new Set(
            (detail.paths || [])
                .filter(Boolean)
                .map(normalizeExternalFileDropPath),
        ))

        if (normalizedPaths.length === 0) return

        if (detail.kind === 'claim' || detail.kind === 'consume') {
            const expiresAt = now + CLAIM_TTL_MS
            normalizedPaths.forEach((path) => {
                this.claims.set(path, {
                    expiresAt,
                    sourceWindowLabel: detail.sourceWindowLabel,
                })
            })
            return
        }

        if (detail.kind === 'release') {
            normalizedPaths.forEach((path) => {
                this.claims.delete(path)
            })
        }
    }

    isClaimed(path: string, currentWindowLabel?: string): boolean {
        const now = Date.now()
        this.cleanup(now)

        const normalized = normalizeExternalFileDropPath(path)
        const claim = this.claims.get(normalized)
        if (!claim) return false
        if (claim.expiresAt <= now) {
            this.claims.delete(normalized)
            return false
        }
        return claim.sourceWindowLabel !== undefined && claim.sourceWindowLabel !== currentWindowLabel
    }
}

export const externalFileDropClaimRegistry = new ExternalFileDropClaimRegistry()
