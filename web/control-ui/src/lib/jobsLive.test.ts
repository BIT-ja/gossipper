import { describe, expect, it } from 'vitest'

import type { Job } from '@/api/v2'

import { computeJobTimeline24h, mergeLiveJobs, parseStatsLines } from '@/lib/jobsLive'

describe('jobsLive', () => {
  it('merges live status onto REST jobs', () => {
    const base: Job[] = [
      { id: 'j1', status: 'pending', created_at: '2026-01-01T00:00:00Z' },
    ]
    const merged = mergeLiveJobs(base, [{ id: 'j1', status: 'running' }])
    expect(merged[0].status).toBe('running')
  })

  it('parses stats jsonl lines', () => {
    const pts = parseStatsLines(['{"kind":"stats","ts":1000,"total_calls":99,"active_calls":3}'])
    expect(pts.length).toBe(1)
    expect(pts[0].value).toBe(3)
  })

  it('builds 24h timeline buckets', () => {
    const now = new Date('2026-05-18T12:00:00Z')
    const jobs: Job[] = [
      {
        id: 'ok',
        status: 'succeeded',
        created_at: '2026-05-18T11:00:00Z',
        finished_at: '2026-05-18T11:05:00Z',
        exit_code: 0,
      },
    ]
    const buckets = computeJobTimeline24h(jobs, now)
    expect(buckets.length).toBe(24)
    expect(buckets.some((b) => b.succeeded >= 1)).toBe(true)
  })
})

it('preserves zero concurrency and ignores legacy heartbeats', () => {
 expect(parseStatsLines(['{"kind":"stats","ts":1000}', '{"kind":"stats","ts":2000,"total_calls":99,"active_calls":0}'])).toEqual([{ts:2000,value:0,label:'stats'}])
})
