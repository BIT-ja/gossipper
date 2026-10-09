export type SIPTraceMessage = { seq: number; call_seq: number; call_id: string; time: string; direction: string; src: string; dst: string; raw: string; summary: string }
export type SIPCaptureStatus = { enabled: boolean; status: string; error?: string; dropped: number; messages: number; expires_at?: string }
export type SIPMessagePage = { messages: SIPTraceMessage[]; next_cursor: number; has_more: boolean }
export function sipTraceURL(jobId: string, resource: string, callId?: string, after?: number) {
  const query = new URLSearchParams()
  if (callId !== undefined) query.set('call_id', callId)
  if (after !== undefined) { query.set('after', String(after)); query.set('limit', '200') }
  return `/api/v2/jobs/${encodeURIComponent(jobId)}/${resource}${query.size ? '?' + query.toString() : ''}`
}
export async function sipTraceRequest<T>(url: string, bearer?: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { headers: bearer ? { Authorization: `Bearer ${bearer}` } : {}, signal })
  if (!res.ok) throw new Error(res.status === 401 ? '登录已失效，请重新登录' : `读取信令失败（HTTP ${res.status}）`)
  return res.json() as Promise<T>
}
export async function downloadSIPTrace(jobId: string, callId: string, bearer?: string) {
  const response = await fetch(sipTraceURL(jobId, 'sip-export', callId), { headers: bearer ? { Authorization: `Bearer ${bearer}` } : {} })
  if (!response.ok) throw new Error(`导出失败（HTTP ${response.status}）`)
  const url = URL.createObjectURL(await response.blob())
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `sip-${callId.replace(/[^a-zA-Z0-9_.-]/g, '_')}.jsonl`
  anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
