import { getJob } from '@/api/v2'
import { fetchArtifactJSON, fetchArtifactText } from '@/lib/artifacts'
import { parseSummaryJSON } from '@/lib/summaryParse'

export async function loadReportPreview(jobId: string, bearer?: string, mode: 'summary' | 'html' | 'both' = 'both'): Promise<{ detail: Awaited<ReturnType<typeof getJob>>; html: string | null; summary: ReturnType<typeof parseSummaryJSON>; errors: string[] }> {
  const detail = await getJob(jobId, { bearer })
  const kinds = new Set(detail.artifacts.map(a => a.kind))
  const errors: string[] = []
  let html: string | null = null
  let summary: ReturnType<typeof parseSummaryJSON> = null
  await Promise.all([
    (async () => {
      if (mode === 'summary' || !kinds.has('report_html')) return
      try { html = await fetchArtifactText(jobId, 'report_html', bearer) }
      catch (e) { errors.push(String(e instanceof Error ? e.message : e)) }
    })(),
    (async () => {
      if (mode === 'html' || !kinds.has('summary')) return
      try { summary = parseSummaryJSON(await fetchArtifactJSON(jobId, 'summary', bearer)) }
      catch (e) { errors.push(String(e instanceof Error ? e.message : e)) }
    })(),
  ])
  return { detail, html, summary, errors }
}
