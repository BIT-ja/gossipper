import { SummaryKPICards } from '@/components/v2/SummaryKPI'
import { JobExecutionDetails } from '@/components/v2/JobExecutionDetails'
import { ArtifactLinks } from '@/components/v2/ArtifactLinks'
import { loadReportPreview } from '@/lib/reportPreview'
import { useEffect, useState } from 'react'

export type ReportPreviewProps = {
  jobId: string
  bearer?: string
  mode?: 'summary' | 'html' | 'both'
}

export function ReportPreview({ jobId, bearer, mode = 'both' }: ReportPreviewProps) {
  const [result, setResult] = useState<Awaited<ReturnType<typeof loadReportPreview>> | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    setResult(null); setError(null)
    void loadReportPreview(jobId, bearer, mode).then(value => {
      if (alive) setResult(value)
    }).catch(e => {
      if (alive) setError(e instanceof Error ? e.message : e?.message ?? String(e))
    })
    return () => { alive = false }
  }, [jobId, bearer, mode])
  if (error) return <p className="text-destructive text-xs">报告数据读取失败：{error}</p>
  if (!result) return <p className="text-muted-foreground text-xs">正在读取报告…</p>
  const { summary, html, detail, errors } = result
  return <div className="flex flex-col gap-3">
    {errors.map(e => <p key={e} className="text-destructive text-xs">报告文件读取失败：{e}</p>)}
    {summary ? <SummaryKPICards kpi={summary} /> : null}
    {summary?.findings.length ? <ul className="text-destructive list-inside list-disc text-xs">
      {summary.findings.map((f, i) => <li key={i}>{f}</li>)}
    </ul> : null}
    {html ? <iframe title="report preview" className="border-border h-[420px] w-full rounded-md border bg-white" srcDoc={html} sandbox="allow-same-origin" /> : <>
      <p className="text-muted-foreground text-xs">未生成 HTML 报告。以下直接展示已保存的执行记录；不包含未采集的 SIP 报文或指标。</p>
      <JobExecutionDetails key={jobId} job={detail.job} artifacts={detail.artifacts} bearer={bearer} />
      <h3 className="font-semibold">All artifacts</h3>
      <ArtifactLinks jobId={jobId} artifacts={detail.artifacts} bearer={bearer} />
    </>}
  </div>
}
