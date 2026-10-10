import { useMemo } from 'react'
import type { StatsPoint } from '@/lib/jobsLive'
import { formatTimestamp } from '@/lib/time'

export type JobStatsChartProps = { points: StatsPoint[]; height?: number }

export function JobStatsChart({ points, height = 64 }: JobStatsChartProps) {
  const { path, peak } = useMemo(() => {
    const peak = Math.max(0, ...points.map(p => p.value))
    const scale = Math.max(1, peak)
    const start = points[0]?.ts ?? 0
    const span = (points.at(-1)?.ts ?? start) - start
    const coords = points.map(p => `${span > 0 ? (p.ts - start) / span * 200 : 100},${height - 4 - p.value / scale * (height - 8)}`)
    return { path: coords.join(' '), peak }
  }, [points, height])
  if (!points.length) return <section aria-label="实时通话并发量"><h4 className="mb-1 text-xs font-medium">实时通话并发量</h4><p className="text-muted-foreground text-xs">暂无并发数据，等待执行进程上报。</p></section>
  const current = points[points.length - 1].value
  return <section aria-label="实时通话并发量" className="space-y-2">
    <div className="flex flex-wrap justify-between gap-2 text-xs"><h4 className="font-medium">实时通话并发量</h4><span>当前 {current} 路 · 窗口峰值 {peak} 路</span></div>
    <svg role="img" aria-label={`并发曲线，当前 ${current} 路，窗口峰值 ${peak} 路`} viewBox={`0 0 200 ${height}`} preserveAspectRatio="none" className="bg-muted/30 h-16 w-full rounded border">
      <polyline fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" className="text-primary" points={path} />
      {points.length === 1 && <circle cx="100" cy={height - 4 - current / Math.max(1, peak) * (height - 8)} r="2" fill="currentColor" className="text-primary" />}
    </svg>
    <div className="text-muted-foreground flex justify-between gap-2 text-[10px]"><span>{formatTimestamp(new Date(points[0].ts).toISOString())}</span><span>{formatTimestamp(new Date(points[points.length - 1].ts).toISOString())}</span></div>
    <p className="text-muted-foreground text-[10px]">最近 {points.length} 个采样点 · 每秒更新 · 并发指正在执行、尚未结束的通话</p>
  </section>
}
