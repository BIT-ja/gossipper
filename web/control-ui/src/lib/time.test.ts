import { describe, expect, it } from 'vitest'
import { formatTimestamp, timestampMillis } from './time'
describe('UTC+8 timestamps', () => {
  it('converts UTC while retaining nanoseconds and crossing dates', () => {
    expect(formatTimestamp('2026-10-09T20:23:39.487039783Z')).toBe('2026-10-10 04:23:39.487039783')
  })
  it('does not convert UTC+8 twice', () => {
    expect(formatTimestamp('2026-10-09T12:23:39.487039783+08:00')).toBe('2026-10-09 12:23:39.487039783')
    expect(formatTimestamp('2026-10-09 12:23:39.487039783')).toBe('2026-10-09 12:23:39.487039783')
  })
  it('uses UTC+8 independently of browser timezone', () => {
    expect(timestampMillis('2026-10-09 12:23:39.487039783')).toBe(Date.parse('2026-10-09T04:23:39.487Z'))
    expect(formatTimestamp(Date.parse('2026-10-09T04:23:39.487Z'))).toBe('2026-10-09 12:23:39.487')
  })
})
