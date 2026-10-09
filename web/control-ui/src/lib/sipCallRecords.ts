export type SIPCallRecord = {
  call_id: string
  call_number?: number
  success?: boolean
  duration_ms?: number
  error?: string
  media?: { RTPPacketsSent?: number; RTPPacketsReceived?: number }
}

export function parseSIPCallRecords(text: string): { records: SIPCallRecord[]; invalid: number } {
  const records: SIPCallRecord[] = []
  let invalid = 0
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const r = JSON.parse(line)
      if (!r || typeof r.call_id !== 'string') { invalid++; continue }
      records.push(r)
    } catch { invalid++ }
  }
  return { records, invalid }
}
