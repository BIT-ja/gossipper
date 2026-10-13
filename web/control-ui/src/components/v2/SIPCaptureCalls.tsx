import { useEffect, useState } from 'react'
import { sipTraceRequest, sipTraceURL, type SIPCaptureStatus } from '@/api/sipTrace'
type CapturedCall = { call_id: string; call_seq: number; shard: number; messages: number }
type CallsPage = { calls: CapturedCall[]; has_more: boolean; next_cursor: number }
const button = 'border-border hover:bg-muted focus-visible:ring-ring min-h-10 rounded border px-3 py-2 focus-visible:ring-2 disabled:opacity-50'
export function SIPCaptureCalls({ jobId, bearer, onSelect }: { jobId: string; bearer?: string; onSelect: (callId: string) => void }) {
  const [page, setPage] = useState<CallsPage>({ calls: [], has_more: false, next_cursor: 0 })
  const [capture, setCapture] = useState<SIPCaptureStatus>()
  const [history, setHistory] = useState<number[]>([0])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [query, setQuery] = useState('')
  const cursor = history[history.length - 1]
  useEffect(() => { setHistory([0]); setCapture(undefined); setPage({ calls: [], has_more: false, next_cursor: 0 }) }, [jobId])
  useEffect(() => {
    const controller = new AbortController(); let busy = false
    setLoading(true)
    async function load() {
      if (busy) return
      busy = true
      try {
        const status = await sipTraceRequest<SIPCaptureStatus>(sipTraceURL(jobId, 'sip-capture'), bearer, controller.signal)
        if (controller.signal.aborted) return
        setCapture(status)
        if (status.enabled && status.status !== 'expired') {
          const next = await sipTraceRequest<CallsPage>(sipTraceURL(jobId, 'sip-calls', undefined, cursor), bearer, controller.signal)
          if (controller.signal.aborted) return
          setPage(next)
        }
        setError('')
      } catch (e) { if (!controller.signal.aborted) setError(String(e)) }
      finally { busy = false; if (!controller.signal.aborted) setLoading(false) }
    }
    void load()
    const timer = setInterval(() => { void load() }, 2000)
    return () => { controller.abort(); clearInterval(timer) }
  }, [jobId, bearer, cursor, refresh])
  const calls = page.calls.filter(call => call.call_id.toLowerCase().includes(query.toLowerCase()))
  return <section aria-label="已捕获通话" className="border-border flex min-w-0 flex-col gap-3 rounded border p-3 text-sm">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-semibold">已捕获通话</h3><p className="text-muted-foreground text-xs">通话进行中即可查看信令 · 每 2 秒刷新 · {capture?.storage === 'mysql' ? 'MySQL 存储' : '每 10,000 通一个分片'}</p></div><button className={button} disabled={!capture?.enabled || capture.status === 'expired'} onClick={() => onSelect('')}>查看未关联信令</button></div>
    {error && <p className="text-destructive" role="alert">{error} <button className={button} onClick={() => setRefresh(n => n + 1)}>重试</button></p>}
    {loading ? <p role="status">正在读取捕获通话…</p> : !capture ? <p>无法读取采集状态。</p> : !capture.enabled ? <p>该任务未开启信令采集。</p> : capture.status === 'expired' ? <p>该任务的信令已超过保留期限。</p> : <>
      {capture.status === 'interrupted' && <p className="text-destructive">采集已中断，下面仅显示已保存的信令。</p>}
      {capture.error && <p className="text-destructive">{capture.error}</p>}
      {(capture.dropped ?? 0) > 0 && <p className="text-destructive">采集不完整：丢弃 {capture.dropped} 条信令。</p>}
      <label className="flex flex-wrap items-center gap-2">筛选本页 Call-ID<input className="border-border min-h-10 min-w-0 rounded border px-3 py-2" value={query} onChange={e => setQuery(e.target.value)} placeholder="输入 Call-ID" /></label>
      <div className="max-h-80 overflow-auto"><table className="w-full text-left"><thead className="bg-muted sticky top-0"><tr><th className="p-2">通话序号</th><th className="p-2">Call-ID</th>{capture?.storage !== 'mysql' && <th className="p-2">分片</th>}<th className="p-2">信令数</th></tr></thead><tbody>{calls.map(call => <tr key={`${call.call_seq}-${call.call_id}`} className="border-border border-t"><td className="p-2 font-mono">{call.call_seq}</td><td className="p-2"><button className="text-primary hover:underline focus-visible:ring-ring min-h-10 max-w-full break-all text-left font-mono focus-visible:ring-2" onClick={() => onSelect(call.call_id)}>{call.call_id || '未关联信令'}</button></td>{capture?.storage !== 'mysql' && <td className="p-2 font-mono">{call.shard}</td>}<td className="p-2">{call.messages}</td></tr>)}</tbody></table>{!calls.length && <p className="p-4 text-center">{page.calls.length ? '本页没有匹配的通话。' : '暂无已捕获通话；运行中任务将在捕获信令后显示。'}</p>}</div>
      <div className="flex flex-wrap items-center justify-between gap-2"><button className={button} disabled={history.length === 1} onClick={() => setHistory(h => h.slice(0, -1))}>上一页</button><span>第 {history.length} 页 · 本页 {page.calls.length} 通</span><button className={button} disabled={!page.has_more} onClick={() => setHistory(h => [...h, page.next_cursor])}>下一页</button></div>
    </>}
  </section>
}
