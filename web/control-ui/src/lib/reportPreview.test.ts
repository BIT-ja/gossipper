import { afterEach, expect, it, vi } from 'vitest'
import { loadReportPreview } from './reportPreview'

afterEach(() => vi.unstubAllGlobals())
it('opens failed jobs without requesting missing report artifacts', async () => {
  const mock = vi.fn(async () => new Response(JSON.stringify({ job: { id: 'failed-job', status: 'failed' }, artifacts: [{ kind: 'call_records' }, { kind: 'log' }] })))
  vi.stubGlobal('fetch', mock)
  const result = await loadReportPreview('failed-job')
  expect(mock).toHaveBeenCalledTimes(1)
  expect(result.detail.job.status).toBe('failed')
  expect(result.html).toBeNull()
  expect(result.errors).toEqual([])
})
it('preserves HTML preview when a separately registered summary is missing on disk', async () => {
  vi.stubGlobal('window', { location: { origin: 'http://localhost' } })
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('/artifacts/report_html')) return new Response('<h1>Report</h1>')
    if (url.includes('/artifacts/summary')) return new Response('missing', { status: 404 })
    return new Response(JSON.stringify({ job: { id: 'job' }, artifacts: [{ kind: 'report_html' }, { kind: 'summary' }] }))
  }))
  const result = await loadReportPreview('job')
  expect(result.html).toBe('<h1>Report</h1>')
  expect(result.errors).toEqual(['artifact summary: HTTP 404'])
})
