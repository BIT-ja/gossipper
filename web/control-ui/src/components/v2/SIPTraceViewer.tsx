import { formatTimestamp, timestampMillis } from '@/lib/time'
import { useEffect, useRef, useState } from 'react'
import { downloadSIPTrace, sipTraceRequest, sipTraceURL, type SIPCaptureStatus, type SIPMessagePage, type SIPTraceMessage } from '@/api/sipTrace'
const control = 'border-border bg-background hover:bg-muted focus-visible:ring-ring min-h-10 rounded border px-3 py-2 text-sm focus-visible:ring-2 disabled:opacity-50'
const states: Record<string, string> = { recording: '采集中', interrupted: '采集中断', running: '采集中', capturing: '采集中', complete: '已结束', completed: '已结束', stopped: '已结束', disabled: '未开启', expired: '已过期', failed: '采集失败', incomplete: '采集不完整', pending: '等待采集', ready: '准备就绪', finished: '已结束', error: '采集失败' }
function color(m: SIPTraceMessage) {
  const code = Number(m.summary.match(/^SIP\/2\.0\s+([1-6]\d\d)\b/i)?.[1] || 0)
  return code >= 400 ? 'text-destructive' : code >= 200 ? 'text-green-700 dark:text-green-400' : code >= 100 ? 'text-amber-700 dark:text-amber-400' : 'text-blue-700 dark:text-blue-400'
}
export function SIPTraceViewer({ jobId, callId, bearer }: { jobId: string; callId: string; bearer?: string }) {
  const [status, setStatus] = useState<SIPCaptureStatus>()
  const [page, setPage] = useState<SIPMessagePage>({ messages: [], next_cursor: 0, has_more: false })
  const [selected, setSelected] = useState<SIPTraceMessage>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [follow, setFollow] = useState(true)
  const [absolute, setAbsolute] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [copied, setCopied] = useState(false)
  const [history, setHistory] = useState<number[]>([0])
  const [refresh, setRefresh] = useState(0)
  const [view, setView] = useState<'flow' | 'raw'>('flow')
  const firstTime = useRef<number | undefined>(undefined)
  const cursor = history[history.length - 1]
  useEffect(() => { setHistory([0]); firstTime.current = undefined; setPage({ messages: [], next_cursor: 0, has_more: false }); setSelected(undefined); setStatus(undefined) }, [jobId, callId])
  useEffect(() => {
    const controller = new AbortController(); let busy = false; let cached: SIPMessagePage | undefined
    setLoading(true)
    async function load() {
      if (busy) return
      busy = true
      try {
        const capture = await sipTraceRequest<SIPCaptureStatus>(sipTraceURL(jobId, 'sip-capture'), bearer, controller.signal)
        if (controller.signal.aborted) return
        setStatus(capture)
        if (cached?.has_more) { setError(''); return }
        if (capture.enabled && capture.status !== 'expired') {
          const after = cached?.messages.at(-1)?.seq ?? cursor
          const delta = await sipTraceRequest<SIPMessagePage>(sipTraceURL(jobId, 'sip-messages', callId, after), bearer, controller.signal)
          const combined = [...(cached?.messages ?? []), ...delta.messages]
          const visible = combined.slice(0, 200)
          const next: SIPMessagePage = { messages: visible, next_cursor: visible.at(-1)?.seq ?? cursor, has_more: Boolean(cached?.has_more || delta.has_more || combined.length > 200) }
          cached = next
          if (controller.signal.aborted) return
          setPage(next)
          if (next.messages.length && firstTime.current === undefined) firstTime.current = timestampMillis(next.messages[0].time)
          setSelected(old => next.messages.find(m => m.seq === old?.seq) ?? next.messages[0])
        }
        setError('')
      } catch (e) { if (!controller.signal.aborted) setError(String(e)) }
      finally { busy = false; if (!controller.signal.aborted) setLoading(false) }
    }
    void load()
    const timer = setInterval(() => { if (follow) void load() }, 2000)
    return () => { controller.abort(); clearInterval(timer) }
  }, [jobId, callId, bearer, cursor, follow, refresh])
  const messages = page.messages.filter(m => `${m.summary} ${m.raw}`.toLowerCase().includes(query.toLowerCase()))
  const endpoints = Array.from(new Set(page.messages.flatMap(m => [m.src, m.dst]).filter(Boolean)))
  return <section className="flex min-w-0 flex-col gap-3 text-sm" aria-label="SIP 信令时序图">
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="min-w-0"><h2 className="font-semibold">SIP 信令时序图</h2><p className="break-all font-mono text-xs">{callId || '未关联信令'}</p></div><div className="flex flex-wrap gap-2"><a className={control} href={`#/jobs/${encodeURIComponent(jobId)}/sip?call_id=${encodeURIComponent(callId)}`} target="_blank" rel="noopener noreferrer">新标签页打开</a><button className={control} disabled={exporting || !status?.enabled || status.status === 'expired'} onClick={async () => { setExporting(true); try { await downloadSIPTrace(jobId, callId, bearer) } catch (e) { setError(String(e)) } finally { setExporting(false) } }}>{exporting ? '正在导出…' : '导出 JSONL'}</button></div></div>
    <div className="bg-muted/50 flex flex-wrap gap-4 rounded p-3"><span>{status ? states[status.status] || status.status : '正在读取…'}</span><span>本页 {page.messages.length} 条</span><span>任务共 {status?.messages ?? '—'} 条</span>{status?.expires_at && <span>保留至 {formatTimestamp(status.expires_at)}</span>}</div>
    {(status?.dropped ?? 0) > 0 && <p role="status" className="text-destructive">采集不完整：已丢弃 {status?.dropped} 条信令。</p>}{status?.error && <p role="alert" className="text-destructive">采集异常：{status.error}</p>}{error && <p role="alert" className="text-destructive">{error} <button className={control} onClick={() => setRefresh(n => n + 1)}>重试</button></p>}
    <div className="flex flex-wrap items-center gap-3"><label className="flex items-center gap-2">查找报文<input className={`${control} w-48`} value={query} onChange={e => setQuery(e.target.value)} placeholder="方法、响应码或内容" /></label><label className="flex min-h-10 items-center gap-2"><input type="checkbox" checked={absolute} onChange={e => setAbsolute(e.target.checked)} />绝对时间</label><label className="flex min-h-10 items-center gap-2"><input type="checkbox" checked={follow} onChange={e => setFollow(e.target.checked)} />每 2 秒刷新当前页</label><div className="flex gap-2 lg:hidden"><button className={control} aria-pressed={view === 'flow'} onClick={() => setView('flow')}>时序图</button><button className={control} aria-pressed={view === 'raw'} onClick={() => setView('raw')}>报文</button></div></div>
    {loading ? <p role="status" className="p-8 text-center">正在读取信令…</p> : !status ? <p className="p-8 text-center">无法读取采集状态，请重试。</p> : !status.enabled ? <p className="p-8 text-center">该任务未开启信令采集，历史记录无法还原 SIP 报文。</p> : status.status === 'expired' ? <p className="p-8 text-center">信令已超过保留期限。</p> : !page.messages.length ? <p className="p-8 text-center">暂无该通话的 SIP 报文。</p> : <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div className={`${view === 'raw' ? 'hidden lg:block' : ''} border-border min-w-0 rounded border`}><div className="max-h-[52vh] overflow-auto"><div className="bg-muted sticky top-0 z-10 flex min-w-[440px] gap-2 border-b p-3"><span className={`${absolute ? 'w-48' : 'w-24'} shrink-0`}>{absolute ? '采集时间' : '相对时间'}</span><div className="flex flex-1 justify-around gap-2">{endpoints.map(e => <span className="max-w-36 break-all text-center font-mono text-xs" key={e}>{e}</span>)}</div></div>
        {messages.map((message, index) => { const left = endpoints.indexOf(message.src); const right = endpoints.indexOf(message.dst); const a = Math.max(0, Math.min(left, right)); const b = Math.max(a + 1, Math.max(left, right)); const n = Math.max(2, endpoints.length); const stamp = timestampMillis(message.time); const time = absolute ? formatTimestamp(message.time) : `${Math.max(0, stamp - (firstTime.current ?? stamp))} ms`
          return <button key={message.seq} aria-pressed={selected?.seq === message.seq} aria-label={`${time} ${message.src} 到 ${message.dst} ${message.summary}`} onClick={() => { setSelected(message); setCopied(false); setView('raw') }} className={`focus-visible:ring-ring flex min-h-14 w-full min-w-[440px] items-center gap-2 border-b px-3 py-2 text-left hover:bg-muted focus-visible:ring-2 ${selected?.seq === message.seq ? 'bg-accent' : ''}`}><span className={`${absolute ? 'w-48' : 'w-24'} shrink-0 font-mono text-xs`}>{time}</span><span className={`relative h-11 flex-1 ${color(message)}`}>{endpoints.map((e, i) => <span key={e} className="border-border absolute top-0 h-full border-l" style={{ left: `${(i + .5) / n * 100}%` }} />)}<span className="absolute top-0 truncate text-center text-xs font-medium" style={{ left: `${(a + .5) / n * 100}%`, width: `${(b - a) / n * 100}%` }}>{message.summary}{messages.slice(0, index).some(previous => previous.raw === message.raw && previous.direction === message.direction) ? ' · 疑似重传' : ''}</span><span className="absolute top-7 border-t-2 border-current" style={{ left: `${(a + .5) / n * 100}%`, width: `${(b - a) / n * 100}%` }}><span className={`absolute -top-[11px] text-base ${left <= right ? '-right-1' : '-left-1'}`}>{left <= right ? '▶' : '◀'}</span></span></span></button>
        })}{!messages.length && <p className="p-6">本页没有匹配的报文。</p>}</div><div className="flex flex-wrap items-center justify-between gap-2 p-3"><button className={control} disabled={history.length === 1} onClick={() => setHistory(h => h.slice(0, -1))}>上一页</button><span>第 {history.length} 页 · 每页最多 200 条</span><button className={control} disabled={!page.has_more} onClick={() => setHistory(h => [...h, page.next_cursor])}>下一页</button></div></div>
      <aside className={`${view === 'flow' ? 'hidden lg:block' : ''} border-border min-w-0 rounded border p-3`} aria-label="所选 SIP 报文">{selected && <><div className="flex items-center justify-between gap-2"><h3 className="font-semibold">报文详情 · #{selected.seq}</h3><button className={control} onClick={async () => { try { await navigator.clipboard.writeText(selected.raw); setCopied(true) } catch { setError('复制失败，请手动选择报文复制') } }}>{copied ? '已复制' : '复制报文'}</button></div><p className="my-2 break-all text-xs">{['send', 'out'].includes(selected.direction) ? '发送' : ['recv', 'in'].includes(selected.direction) ? '接收' : selected.direction === 'send_error' ? '发送失败' : selected.direction} · {selected.src} → {selected.dst}<br />{formatTimestamp(selected.time)}</p><pre className="bg-muted/50 max-h-[46vh] overflow-auto rounded p-3 font-mono text-xs whitespace-pre-wrap break-all">{selected.raw}</pre></>}</aside>
    </div>}
    <p className="text-muted-foreground text-xs">仅显示本压测机采集的信令；发送记录不代表对端已收到。鉴权及密钥内容已脱敏。</p>
  </section>
}
