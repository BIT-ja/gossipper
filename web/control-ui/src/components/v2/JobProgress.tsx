import { useEffect, useState } from 'react'
import type { Job } from '@/api/v2'
import { timestampMillis } from '@/lib/time'

export function latestProgress(lines: string[]) {
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const e = JSON.parse(lines[i])
      if (e.kind === 'stats' && ['total_calls', 'success_calls', 'failed_calls', 'active_calls', 'target_calls'].every(k => typeof e[k] === 'number' && Number.isFinite(e[k]))) return e as Record<string, number>
    } catch { /* partial/non-JSON output */ }
  }
  return null
}

export function JobProgress({ lines, job }: { lines: string[]; job: Job }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])
  const p = latestProgress(lines)
  const completed = p ? p.success_calls + p.failed_calls : 0
  const percent = p && p.target_calls > 0 ? Math.min(100, completed / p.target_calls * 100) : null
  const start = job.started_at ? timestampMillis(job.started_at) : NaN
  const end = job.finished_at ? timestampMillis(job.finished_at) : now
  const elapsed = Number.isFinite(start) ? Math.max(0, Math.floor((end - start) / 1000)) : null
  return <section className="mb-3 rounded-lg border p-3" aria-label="任务执行进度">
    <div className="mb-2 flex justify-between gap-3 text-sm font-medium"><span>任务执行进度</span><span>已运行 {elapsed === null ? '—' : `${elapsed} 秒`}</span></div>
    {p ? <>
      <div className="mb-2 text-sm">{percent === null ? '不限总通话量' : `已完成 ${completed} / ${p.target_calls} 通（${percent.toFixed(1)}%）`}</div>
      {percent !== null && <progress aria-label="已结束通话占目标比例" value={completed} max={p.target_calls} className="mb-3 h-2 w-full accent-blue-600" />}
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">{[['已发起', p.total_calls], ['当前并发', p.active_calls], ['成功', p.success_calls], ['失败', p.failed_calls]].map(([label, value]) => <div key={label}><dt className="text-muted-foreground text-xs">{label}</dt><dd className="font-mono text-lg">{value}</dd></div>)}</dl>
      <p className="text-muted-foreground mt-2 text-xs">完成数包含成功与失败；最大执行时长：{p.global_timeout_ms > 0 ? `${p.global_timeout_ms / 1000} 秒` : '不限'}。{job.status === 'running' && now - p.ts > 5000 ? '统计暂未更新，请检查任务连接。' : ''}</p>
    </> : <p className="text-muted-foreground text-sm">等待通话统计。旧版本启动的任务不提供实时计数，需查看结束报告。</p>}
  </section>
}
