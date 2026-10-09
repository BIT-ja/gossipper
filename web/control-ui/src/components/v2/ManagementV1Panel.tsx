import { useCallback, useEffect, useState } from 'react'

import {
  addV1Client,
  deleteV1Client,
  getV1Control,
  getV1Health,
  getV1Stats,
  listV1Clients,
  patchV1Control,
  type V1Control,
  type V1ControlEngine,
  type V1StatsEngine,
} from '@/api/v1'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export type ManagementV1PanelProps = {
  bearer?: string
}

export function ManagementV1Panel({ bearer }: ManagementV1PanelProps) {
  const [available, setAvailable] = useState<boolean | null>(null)
  const [control, setControl] = useState<V1Control | null>(null)
  const [stats, setStats] = useState<(V1StatsEngine & { engines?: V1StatsEngine[] }) | null>(null)
  const [clients, setClients] = useState<Awaited<ReturnType<typeof listV1Clients>> | null>(null)
  const [rateDraft, setRateDraft] = useState('')
  const [engineRates, setEngineRates] = useState<Record<string, string>>({})
  const [newClientJSON, setNewClientJSON] = useState('{"transport":"udp","rate":1}')
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      await getV1Health({ bearer })
      setAvailable(true)
      setControl(await getV1Control({ bearer }))
      setStats(await getV1Stats({ bearer }))
      setClients(await listV1Clients({ bearer }))
      setError(null)
    } catch (e) {
      setAvailable(false)
      setError(String(e instanceof Error ? e.message : e))
    }
  }, [bearer])

  useEffect(() => {
    void refresh()
    const t = setInterval(() => void refresh(), 5000)
    return () => clearInterval(t)
  }, [refresh])

  const engines: V1ControlEngine[] =
    control?.multi && control.engines
      ? control.engines
      : control
        ? [{ id: 'primary', rate: control.rate ?? 0, paused: control.paused ?? false }]
        : []

  if (available === null) return <p className="text-muted-foreground text-xs">正在探测 /api/v1…</p>
  if (!available) {
    return (
      <Card className="border-border/80">
        <CardHeader>
          <CardTitle className="text-sm">混合引擎控制（/api/v1）</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-xs">
            当前监听地址不提供旧版管理 API（通常出现在 <code>gossipper ui</code> 模式）。请运行 <code>gossipper server</code> 并使用混合配置，设置 <code>legacy_api_v1: true</code> 以控制速率、暂停及动态客户端。
          </p>
          {error ? <p className="text-muted-foreground mt-2 text-[11px]">{error}</p> : null}
        </CardContent>
      </Card>
    )
  }

  const onSetRateAll = () => {
    const rate = parseFloat(rateDraft)
    if (!Number.isFinite(rate) || rate <= 0) return
    void patchV1Control({ rate }, { bearer }).then(setControl)
  }

  const onSetEngineRate = (engineId: string) => {
    const rate = parseFloat(engineRates[engineId] ?? '')
    if (!Number.isFinite(rate) || rate <= 0) return
    void patchV1Control({ engine_id: engineId, rate }, { bearer }).then(setControl)
  }

  const onPauseEngine = (engineId: string, paused: boolean) =>
    void patchV1Control({ engine_id: engineId, paused }, { bearer }).then(setControl)

  const onPauseAll = (paused: boolean) => void patchV1Control({ paused }, { bearer }).then(setControl)

  const onAddClient = () => {
    let body: Record<string, unknown>
    try {
      body = JSON.parse(newClientJSON) as Record<string, unknown>
    } catch {
      setError('客户端 JSON 格式无效')
      return
    }
    void addV1Client(body, undefined, { bearer }).then(() => refresh())
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">混合引擎控制（/api/v1）</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-xs">
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <Label className="text-[10px]">设置所有引擎速率</Label>
            <Input className="mt-1 h-8 w-28" value={rateDraft} onChange={(e) => setRateDraft(e.target.value)} placeholder="4" />
          </div>
          <Button type="button" size="sm" onClick={onSetRateAll}>
            应用到全部
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => onPauseAll(true)}>
            全部暂停
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => onPauseAll(false)}>
            全部恢复
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => void refresh()}>
            刷新
          </Button>
        </div>
        {engines.length > 0 ? (
          <div className="border-border rounded-md border p-2">
            <div className="text-muted-foreground mb-2 font-medium">各引擎控制</div>
            <ul className="space-y-2">
              {engines.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-2 font-mono">
                  <span className="min-w-[8rem]">{e.id}</span>
                  <span className="text-muted-foreground">
                    rate={e.rate} {e.paused ? 'PAUSED' : 'running'}
                  </span>
                  <Input
                    className="h-7 w-20 text-xs"
                    placeholder="rate"
                    value={engineRates[e.id] ?? ''}
                    onChange={(ev) => setEngineRates({ ...engineRates, [e.id]: ev.target.value })}
                  />
                  <Button type="button" size="xs" onClick={() => onSetEngineRate(e.id)}>
                    设置速率
                  </Button>
                  <Button type="button" size="xs" variant="outline" onClick={() => onPauseEngine(e.id, !e.paused)}>
                    {e.paused ? 'Resume' : 'Pause'}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {stats?.engines ? (
          <div>
            <div className="text-muted-foreground mb-1 font-medium">统计</div>
            <ul className="font-mono space-y-0.5">
              {stats.engines.map((e) => (
                <li key={e.id}>
                  {e.id}: {e.success_calls ?? 0}/{e.total_calls ?? 0} active={e.active_calls ?? 0} cps=
                  {(e.calls_per_second ?? 0).toFixed(2)}
                </li>
              ))}
            </ul>
          </div>
        ) : stats ? (
          <p>
            通话 {stats.success_calls ?? 0}/{stats.total_calls ?? 0} cps={(stats.calls_per_second ?? 0).toFixed(2)}
          </p>
        ) : null}
        {clients?.dynamic_client_api?.can_post ? (
          <div className="flex flex-col gap-1">
            <Label className="text-[10px]">POST /api/v1/clients JSON</Label>
            <textarea
              className="border-input bg-background min-h-[80px] rounded-md border px-2 py-1 font-mono text-[11px]"
              value={newClientJSON}
              onChange={(e) => setNewClientJSON(e.target.value)}
            />
            <Button type="button" size="sm" className="self-start" onClick={onAddClient}>
              添加动态客户端
            </Button>
          </div>
        ) : null}
        {clients?.engines?.length ? (
          <ul className="space-y-1">
            {clients.engines.map((c) => (
              <li key={c.id} className="flex items-center gap-2 font-mono">
                {c.id} {c.dynamic ? '(dynamic)' : ''}
                {c.dynamic && clients.dynamic_client_api?.can_delete ? (
                  <Button type="button" size="xs" variant="destructive" onClick={() => void deleteV1Client(c.id, { bearer }).then(refresh)}>
                    移除
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  )
}
