import { formatTimestamp } from '@/lib/time'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { listAudit, type AuditEntry } from '@/api/v2'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

export type AuditLogPanelProps = {
  bearer?: string
  autoRefresh?: boolean
  limit?: number
  onRefresh?: () => void
}

export function AuditLogPanel({
  bearer,
  autoRefresh = true,
  limit = 200,
  onRefresh,
}: AuditLogPanelProps) {
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [filter, setFilter] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadAudit = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await listAudit({ bearer }, limit)
      setAudit(r.audit ?? [])
      onRefresh?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [bearer, limit, onRefresh])

  useEffect(() => {
    void loadAudit()
  }, [loadAudit])

  useEffect(() => {
    if (!autoRefresh) return
    const tick = setInterval(() => {
      void loadAudit()
    }, 4000)
    return () => clearInterval(tick)
  }, [autoRefresh, loadAudit])

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return audit
    return audit.filter(
      (e) =>
        e.action.toLowerCase().includes(q) ||
        (e.username ?? '').toLowerCase().includes(q) ||
        (e.target ?? '').toLowerCase().includes(q),
    )
  }, [audit, filter])

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-sm">审计日志</CardTitle>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="xs" onClick={() => void loadAudit()} disabled={loading}>
            刷新
          </Button>
          <span className="text-muted-foreground text-[11px]">
            {filtered.length}/{audit.length}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground mb-2 text-xs">
          变更操作经由 <code>/api/v2</code> （最多 {limit}).
        </p>
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="按操作、用户或目标筛选…"
          className="mb-2 h-7 max-w-md text-xs"
        />
        {error ? <p className="text-destructive mb-2 text-xs">{error}</p> : null}
        {filtered.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            {audit.length === 0 ? '暂无记录。' : '没有符合筛选条件的记录。'}
          </p>
        ) : (
          <div className="max-h-[32rem] overflow-auto rounded-md border">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground bg-muted/30 sticky top-0">
                <tr>
                  <th className="border-border border-b px-2 py-1 text-left">时间</th>
                  <th className="border-border border-b px-2 py-1 text-left">用户</th>
                  <th className="border-border border-b px-2 py-1 text-left">操作</th>
                  <th className="border-border border-b px-2 py-1 text-left">目标</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => (
                  <tr key={e.id} className="border-border border-b">
                    <td className="px-2 py-1 font-mono whitespace-nowrap">
                      {formatTimestamp(e.ts)}
                    </td>
                    <td className="px-2 py-1">{e.username || '—'}</td>
                    <td className="px-2 py-1 font-mono">{e.action}</td>
                    <td className="px-2 py-1 font-mono break-all">{e.target || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
