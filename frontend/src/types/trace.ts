export interface LotQr {
  trace_code: string
  status: 'ACTIVE' | 'REVOKED'
  created_at: string
  revoked_at: string | null
  revocation_reason: string | null
  issuer_organization_id: string | null
  issuer: { name: string } | null
}

export interface LotQrResponse { success: boolean; qr: LotQr | null; canIssue: boolean; canRevoke: boolean }

export interface PublicTrace {
  lotCode: string
  species: string
  quantity: number
  harvestDate: string
  farm: { name: string; address: string | null }
  pond: { code: string; name: string }
  batch: { code: string; seedSource: string | null; stockingDate: string }
  logs: { type: string; date: string; blockchainStatus: string | null; details: Record<string, string | number | null> }[]
  transports: {
    code: string; date: string; status: string; quantity: number; recipientName: string | null
    events: { type: string; date: string; temperature: number | null; trackingStatus: string | null; blockchainStatus: string | null }[]
  }[]
  proof: {
    status: 'MATCH' | 'MISMATCH' | 'PENDING' | 'UNAVAILABLE'
    recordedStatus: string | null
    transactionHash: string | null
    checkedAt: string | null
  }
}

export type PublicTraceResponse = { success: boolean } & (
  { status: 'ACTIVE'; trace: PublicTrace } | { status: 'REVOKED'; trace?: never }
)
