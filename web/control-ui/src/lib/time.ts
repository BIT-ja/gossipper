// API timestamps and capture timestamps denote UTC; retain fractional precision.
export function formatTimestamp(value: string | number | null | undefined): string {
  if (value == null || value === '') return '—'
  if (typeof value === 'string') {
    const match = value.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(\.\d+)?(?:Z|\+00:00)?$/)
    if (match) return `${match[1]} ${match[2]}${match[3] ?? ''}`
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString().replace('T', ' ').replace(/Z$/, '')
}
export function timestampMillis(value: string): number {
  return Date.parse(/^\d{4}-\d{2}-\d{2} /.test(value) ? value.replace(' ', 'T') + 'Z' : value)
}
