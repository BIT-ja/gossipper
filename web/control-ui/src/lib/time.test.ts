import { describe, expect, it } from 'vitest'
import { formatTimestamp, timestampMillis } from './time'
describe('timestamps', () => {
  it('retains nanosecond precision without ISO separators', () => {
    expect(formatTimestamp('2026-10-09T12:23:39.487039783Z')).toBe('2026-10-09 12:23:39.487039783')
    expect(formatTimestamp('2026-10-09 12:23:39.487039783')).toBe('2026-10-09 12:23:39.487039783')
  })
  it('parses capture times as UTC for relative duration', () => {
    expect(timestampMillis('2026-10-09 12:23:39.487039783')).toBe(Date.parse('2026-10-09T12:23:39.487Z'))
  })
})
