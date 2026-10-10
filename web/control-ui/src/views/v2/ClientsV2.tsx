import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  createClient,
  deleteClient,
  listBuiltinScenarios,
  listClients,
  listScenarios,
  listServers,
  startClientProfile,
  stopClientProfile,
  updateClient,
  type BuiltinScenarioMeta,
  type ClientProfile,
  type ScenarioMeta,
  type ServerProfile,
  type TransportSpec,
} from '@/api/v2'
import { ScenarioPreview, ScenarioSelect } from '@/components/v2/ScenarioSelect'
import { Button } from '@/components/ui/button'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Modal } from '@/components/ui/modal'
import { Textarea } from '@/components/ui/textarea'
import { RuntimeBadge } from '@/components/v2/RuntimeBadge'
import { TransportListEditor } from '@/components/v2/TransportListEditor'
import { crossProfilePortConflicts, isProfilePortBlocked } from '@/lib/profileHelpers'
import { useToast } from '@/lib/toast'

const emptyDraft = (): ClientProfile => ({
  id: '',
  name: '',
  transports: [{ transport: 'u1', local_ip: '0.0.0.0', local_port: 0, enabled: true }],
  rate: 1,
  max_concurrent: 100,
})

export type ClientsV2Props = {
  bearer?: string
  busy: boolean
  run: <T>(fn: () => Promise<T>) => Promise<T | undefined>
  errorText?: string | null
}

export function ClientsV2({ bearer, busy, run, errorText }: ClientsV2Props) {
  const { toast } = useToast()
  const [rows, setRows] = useState<ClientProfile[]>([])
  const [servers, setServers] = useState<ServerProfile[]>([])
  const [scenarios, setScenarios] = useState<ScenarioMeta[]>([])
  const [builtins, setBuiltins] = useState<BuiltinScenarioMeta[]>([])
  const [draft, setDraft] = useState<ClientProfile | null>(null)
  const [createMode, setCreateMode] = useState(false)

  const refresh = useCallback(async () => {
    const [r, s, sc, bi] = await Promise.all([
      listClients({ bearer }),
      listServers({ bearer }),
      listScenarios({ bearer }),
      listBuiltinScenarios({ bearer }).catch(() => ({ scenarios: [] as BuiltinScenarioMeta[] })),
    ])
    setRows(r.clients ?? [])
    setServers(s.servers ?? [])
    setScenarios(sc.scenarios ?? [])
    setBuiltins(bi.scenarios ?? [])
  }, [bearer])

  // Refresh only the rows (cheap) without touching the run/busy spinner.
  // Used by the auto-poll loop so the status column stays live without
  // grey-ing out the table every 3 s.
  const refreshRowsOnly = useCallback(async () => {
    try {
      const r = await listClients({ bearer })
      setRows(r.clients ?? [])
    } catch (err) {
      console.warn('refresh clients:', err)
    }
  }, [bearer])

  useEffect(() => {
    void run(() => refresh())
  }, [run, refresh])

  useEffect(() => {
    const id = window.setInterval(() => {
      void refreshRowsOnly()
    }, 3000)
    return () => window.clearInterval(id)
  }, [refreshRowsOnly])

  const onSave = () => {
    if (!draft) return
    void run(async () => {
      if (createMode) {
        await createClient(draft, { bearer })
      } else {
        await updateClient(draft.id, draft, { bearer })
      }
      setDraft(null)
      await refresh()
    })
  }

  const onDelete = (row: ClientProfile) => {
    if (!window.confirm(`删除客户端配置 "${row.id}"?`)) return
    void run(async () => {
      await deleteClient(row.id, { bearer })
      await refresh()
    })
  }
  const onDuplicate = (row: ClientProfile) => {
    const base = `${row.id}-copy`
    let id = base
    let n = 2
    while (rows.some((r) => r.id === id)) {
      id = `${base}-${n++}`
    }
    setDraft({
      ...row,
      id,
      name: `${row.name} (copy)`,
      source: undefined,
      runtime: undefined,
      transports: (row.transports ?? []).map((t) => ({ ...t })),
    })
    setCreateMode(true)
  }

  const onStart = (row: ClientProfile) => {
    const block = isProfilePortBlocked('client', row.id, servers, rows)
    if (block.blocked) {
      toast(`端口冲突： ${block.details.join(', ')}`, 'error')
      return
    }
    void run(async () => {
      try {
        await startClientProfile(row.id, { bearer })
        toast("任务已启动", 'success')
      } catch (err) {
        console.warn('start:', err)
      } finally {
        await refresh()
      }
    })
  }
  const onStop = (row: ClientProfile) => {
    void run(async () => {
      try {
        await stopClientProfile(row.id, { bearer })
      } catch (err) {
        console.warn('stop:', err)
      } finally {
        await refresh()
      }
    })
  }

  const conflicts = useMemo(() => crossProfilePortConflicts(servers, rows), [servers, rows])

  const columns: Column<ClientProfile>[] = useMemo(
    () => [
      {
        key: 'id',
        header: 'ID',
        render: (r) => (
          <span className="inline-flex items-center gap-1.5">
            <code className="text-xs">{r.id}</code>
            {conflicts.conflicting.has(`client:${r.id}`) ? (
              <span
                className="bg-destructive/15 text-destructive rounded px-1 py-0.5 font-mono text-[9px] uppercase"
                title={`端口冲突： ${(conflicts.details.get(`client:${r.id}`) ?? []).join(', ')}`}
              >
                端口冲突
              </span>
            ) : null}
          </span>
        ),
      },
      { key: 'name', header: "名称", render: (r) => r.name },
      {
        key: 'status',
        header: "状态",
        render: (r) => <RuntimeBadge runtime={r.runtime} />,
      },
      {
        key: 'target',
        header: "目标",
        render: (r) =>
          r.remote_ip ? (
            <code className="text-xs">
              {r.remote_ip}:{r.remote_port ?? '-'}
            </code>
          ) : (
            '—'
          ),
      },
      {
        key: 'load',
        header: "负载",
        render: (r) => (
          <span className="font-mono text-xs">
            {r.rate ?? 0} cps · {r.max_concurrent ?? 0} 最大值
          </span>
        ),
      },
      {
        key: 'scenario',
        header: "场景",
        render: (r) => (r.scenario_ref ? <code className="text-xs">{r.scenario_ref}</code> : '—'),
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        render: (r) => {
          const builtin = r.source === 'built-in'
          const title = builtin
            ? '内置配置在主进程中运行，修改后需要重启服务。'
            : undefined
          const portBlock = isProfilePortBlocked('client', r.id, servers, rows)
          return (
            <div className="flex justify-end gap-1">
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => onStart(r)}
                disabled={busy || builtin || portBlock.blocked}
                title={
                  portBlock.blocked
                    ? `端口冲突： ${portBlock.details.join(', ')}`
                    : title
                }
              >
                启动
              </Button>
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => onStop(r)}
                disabled={busy || builtin}
                title={title}
              >
                停止
              </Button>
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => {
                  setDraft({ ...r, transports: r.transports ?? [] })
                  setCreateMode(false)
                }}
              >
                编辑
              </Button>
              <Button type="button" variant="outline" size="xs" onClick={() => onDuplicate(r)}>
                复制
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="xs"
                onClick={() => onDelete(r)}
                disabled={builtin}
                title={title}
              >
                删除
              </Button>
            </div>
          )
        },
      },
    ],
    [busy, conflicts, onDelete, onStart, onStop],
  )

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">客户端配置（UAC）</h2>
          <p className="text-muted-foreground text-xs">
            供任务启动压测使用的配置模板，存储于 <code>profiles/clients/&lt;id&gt;.json</code>.
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void run(() => refresh())}>
            刷新
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setDraft(emptyDraft())
              setCreateMode(true)
            }}
          >
            + 新建客户端配置
          </Button>
        </div>
      </div>

      {errorText ? (
        <div className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-xs">
          {errorText}
        </div>
      ) : null}

      {conflicts.conflicting.size > 0 ? (
        <div className="border-warning/40 bg-warning/10 text-warning-foreground rounded-md border px-3 py-2 text-xs">
          <span className="font-medium">本地端口冲突：</span>{' '}
          {conflicts.conflicting.size} 个客户端配置{conflicts.conflicting.size > 1 ? 's' : ''} 使用相同本地地址族/端口，同时运行将导致绑定失败。涉及：{' '}
          <code>{Array.from(conflicts.conflicting).join(', ')}</code>
        </div>
      ) : null}

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        loading={busy && rows.length === 0}
        empty="暂无客户端配置，请点击上方按钮创建。"
      />

      <Modal
        open={draft !== null}
        onClose={() => setDraft(null)}
        size="lg"
        title={createMode ? "新建客户端配置" : `编辑客户端配置 · ${draft?.id ?? ''}`}
        footer={
          <>
            <Button type="button" variant="outline" size="sm" onClick={() => setDraft(null)}>
              取消
            </Button>
            <Button type="button" size="sm" onClick={onSave} disabled={busy}>
              {createMode ? "创建" : "保存"}
            </Button>
          </>
        }
      >
        {draft ? (
          <ClientForm
            value={draft}
            onChange={setDraft}
            scenarios={scenarios}
            builtins={builtins}
            disableId={!createMode}
          />
        ) : null}
      </Modal>
    </section>
  )
}

function ClientForm({
  value,
  onChange,
  scenarios,
  builtins,
  disableId,
}: {
  value: ClientProfile
  onChange: (v: ClientProfile) => void
  scenarios: ScenarioMeta[]
  builtins: BuiltinScenarioMeta[]
  disableId: boolean
}) {
  const set = <K extends keyof ClientProfile>(k: K, v: ClientProfile[K]) => onChange({ ...value, [k]: v })
  const setTransports = (t: TransportSpec[]) => onChange({ ...value, transports: t })
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <Label className="text-xs">ID</Label>
          <Input
            value={value.id}
            onChange={(e) => set('id', e.target.value)}
            disabled={disableId}
            className="mt-1"
            placeholder="stress-uac"
          />
        </div>
        <div>
          <Label className="text-xs">名称</Label>
          <Input
            value={value.name}
            onChange={(e) => set('name', e.target.value)}
            className="mt-1"
            placeholder="Stress UAC"
          />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div>
          <Label className="text-xs">目标 IP</Label>
          <Input
            value={value.remote_ip ?? ''}
            onChange={(e) => set('remote_ip', e.target.value)}
            className="mt-1"
            placeholder="127.0.0.1"
          />
        </div>
        <div>
          <Label className="text-xs">目标端口</Label>
          <Input
            type="number"
            value={value.remote_port ?? 0}
            onChange={(e) => set('remote_port', Number(e.target.value) || 0)}
            className="mt-1"
          />
        </div>
        <div>
          <Label className="text-xs">场景</Label>
          <ScenarioSelect
            value={value.scenario_ref ?? ''}
            onChange={(id) => set('scenario_ref', id || undefined)}
            scenarios={scenarios}
            builtins={builtins}
            roleFilter="uac"
          />
          <ScenarioPreview
            scenarioId={value.scenario_ref ?? ''}
            scenarios={scenarios}
            builtins={builtins}
          />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div><Label htmlFor="client-total-calls" className="text-xs">总通话量（0 表示不限）</Label>
        <Input id="client-total-calls" type="number" min="0" step="1" value={value.total_calls ?? 1}
          onChange={(e) => set('total_calls', Number(e.target.value))} className="mt-1" /></div>
        <div>
          <Label className="text-xs">呼叫速率（CPS）</Label>
          <Input
            type="number"
            value={value.rate ?? 0}
            onChange={(e) => set('rate', Number(e.target.value) || 0)}
            className="mt-1"
          />
        </div>
        <div>
          <Label className="text-xs">最大并发通话数</Label>
          <Input
            type="number"
            value={value.max_concurrent ?? 0}
            onChange={(e) => set('max_concurrent', Number(e.target.value) || 0)}
            className="mt-1"
          />
        </div>
        <div>
          <Label className="text-xs">默认最大执行时长（秒，0 表示不限）</Label>
          <Input
            type="number"
            value={(value.duration_ms ?? 0) / 1000}
            onChange={(e) => set('duration_ms', (Number(e.target.value) || 0) * 1000)}
            className="mt-1"
          />
        </div>
      </div>
      <div>
        <Label className="text-xs">本地监听地址</Label>
        <div className="mt-1">
          <TransportListEditor value={value.transports ?? []} onChange={setTransports} defaultPort={0} />
        </div>
      </div>
      <div>
        <Label className="text-xs">备注</Label>
        <Textarea
          value={value.notes ?? ''}
          onChange={(e) => set('notes', e.target.value)}
          className="mt-1 min-h-[80px]"
        />
      </div>
    </div>
  )
}
