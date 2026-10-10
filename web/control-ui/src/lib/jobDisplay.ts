/** Display-only conversion: API and saved job arguments retain millisecond units. */
export function displayJobArgs(raw?: string): string {
  if (!raw) return '{}'
  try {
    const args = JSON.parse(raw)
    if (!args || Array.isArray(args) || typeof args !== 'object') return raw
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(args)) {
      if (typeof value === 'number' && (key === 'global_timeout_ms' || key === 'duration_ms')) {
        out[key === 'global_timeout_ms' ? '最大执行时长（秒）' : '持续时间（秒）'] = value === 0 ? '不限' : value / 1000
      } else out[key] = value
    }
    return JSON.stringify(out, null, 2)
  } catch { return raw }
}
