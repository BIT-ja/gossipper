const UTC8_MS = 8 * 60 * 60 * 1000
// Zone-less API capture timestamps are already UTC+8. Preserve all fractional digits.
export function formatTimestamp(value: string | number | null | undefined): string {
  if (value == null || value === '') return '—'
  const text = String(value)
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(text)) return text
  const ms = typeof value === 'number' ? value : timestampMillis(value)
  if (!Number.isFinite(ms)) return text
  const fraction = typeof value === 'string' ? value.match(/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/)?.[1] : undefined
  const date = new Date(ms + UTC8_MS).toISOString()
  return date.slice(0, 19).replace('T', ' ') + '.' + (fraction ?? date.slice(20, 23))
}
export function timestampMillis(value: string): number {
  return Date.parse(/^\d{4}-\d{2}-\d{2} /.test(value) ? value.replace(' ', 'T') + '+08:00' : value)
}
