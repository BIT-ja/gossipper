import { SIPTraceViewer } from '@/components/v2/SIPTraceViewer'
import { SIPCaptureCalls } from '@/components/v2/SIPCaptureCalls'
import { Modal } from '@/components/ui/modal'
import { useEffect, useMemo, useState } from 'react'
import type { Job, JobArtifact } from '@/api/v2'
import { fetchArtifactText } from '@/lib/artifacts'
import { parseSIPCallRecords, type SIPCallRecord } from '@/lib/sipCallRecords'

export function JobExecutionDetails({ job, artifacts, bearer }: { job: Job; artifacts: JobArtifact[]; bearer?: string }) {
  const [traceCall,setTraceCall] = useState<string|null>(null)
  const [log, setLog] = useState('')
  const [records, setRecords] = useState<SIPCallRecord[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [invalid, setInvalid] = useState(0)
  const [loading, setLoading] = useState(true)
  const [failedOnly, setFailedOnly] = useState(job.status === 'failed')
  const [query, setQuery] = useState('')
  const kinds = artifacts.map(a => a.kind).sort().join(',')
  useEffect(() => {
    let cancelled = false
    setLoading(true); setLog(''); setRecords([]); setErrors([]); setInvalid(0)
    const available = new Set(kinds.split(','))
    void Promise.all(['log', 'call_records'].map(async kind => {
      if (!available.has(kind)) return
      try {
        const text = await fetchArtifactText(job.id, kind, bearer)
        if (cancelled) return
        if (kind === 'log') setLog(text)
        else { const parsed = parseSIPCallRecords(text); setRecords(parsed.records); setInvalid(parsed.invalid) }
      } catch (e) { if (!cancelled) setErrors(prev => [...prev, String(e)]) }
    })).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [job.id, job.status, kinds, bearer])
  const failed = records.filter(r => r.success === false).length
  const succeeded = records.filter(r => r.success === true).length
  const visible = useMemo(() => records.filter(r => (!failedOnly || r.success === false) && `${r.call_id} ${r.error ?? ''}`.toLowerCase().includes(query.toLowerCase())), [records, failedOnly, query])
  return <><Modal open={traceCall!==null} onClose={()=>setTraceCall(null)} title="SIP 信令时序图" size="trace">{traceCall!==null && <SIPTraceViewer jobId={job.id} callId={traceCall} bearer={bearer}/>}</Modal><section className="border-border flex flex-col gap-2 rounded border p-3">
    <SIPCaptureCalls jobId={job.id} bearer={bearer} onSelect={setTraceCall}/>
    <h3 className="font-semibold">执行详情</h3>
    {loading ? <p>正在读取执行记录…</p> : <>
      {errors.map(e => <p key={e} className="text-destructive">{e}</p>)}
      {!artifacts.some(a => a.kind === 'summary') && <p className="text-muted-foreground">该任务未生成汇总报告；以下统计来自已保存的逐通话记录。</p>}
      <p>已记录 {records.length} 通 · 成功 {succeeded} · 失败 {failed} · 状态未知 {records.length - succeeded - failed}</p>
      {invalid > 0 && <p className="text-destructive">{invalid} 行记录无法解析，未计入统计。</p>}
      <details open={job.status === 'failed'}>
        <summary className="cursor-pointer font-medium">执行日志（worker.log）</summary>
        <pre className="bg-muted/40 max-h-40 overflow-auto rounded p-2 text-[11px] whitespace-pre-wrap break-all">{log || '暂无执行日志产物'}</pre>
      </details>
      <label className="flex items-center gap-2"><input type="checkbox" checked={failedOnly} onChange={e => setFailedOnly(e.target.checked)} />只看失败通话</label>
      <input className="border-border rounded border px-2 py-1" placeholder="搜索 Call-ID 或错误信息" value={query} onChange={e => setQuery(e.target.value)} />
      <p className="text-muted-foreground">匹配 {visible.length} 通；最多展示前 200 通，完整记录可在“全部产物”中下载通话记录（call_records）。</p>
      <div className="max-h-72 overflow-auto"><table className="w-full text-left text-[11px]"><thead><tr><th>Call-ID</th><th>结果</th><th>时长 ms</th><th>RTP 发 / 收</th><th>错误</th></tr></thead><tbody>
        {visible.slice(0,200).map((r,i) => <tr key={`${r.call_id}-${i}`} className="border-border border-t align-top"><td className="max-w-48 break-all p-1 font-mono"><button className="text-primary underline" onClick={()=>setTraceCall(r.call_id)} title="查看 SIP 信令时序图">{r.call_id}</button></td><td className="p-1">{r.success === true ? '成功' : r.success === false ? '失败' : '未知'}</td><td className="p-1">{r.duration_ms ?? '—'}</td><td className="p-1">{r.media?.RTPPacketsSent ?? '—'} / {r.media?.RTPPacketsReceived ?? '—'}</td><td className="max-w-64 break-words p-1">{r.error || '—'}</td></tr>)}
      </tbody></table></div>
    </>}
  </section></>
}
