import { displayJobArgs } from '@/lib/jobDisplay'
import { JobProgress } from '@/components/v2/JobProgress'
import { formatTimestamp } from '@/lib/time'
import { displayLabel } from '@/lib/displayLabel'
import { sipTraceRequest, sipTraceURL, type SIPCaptureStatus } from '@/api/sipTrace'
import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  deleteJobV2,
  getJob,
  listBuiltinScenarios,
  listClients,
  listJobs,
  listRecordings,
  listScenarios,
  listServers,
  jobEventsURL,
  recordingURL,
  runTool,
  startJob,
  stopJob,
  type BuiltinScenarioMeta,
  type ClientProfile,
  type Job,
  type JobArtifact,
  type JobStatus,
  type Recording,
  type ScenarioMeta,
  type ServerProfile,
} from '@/api/v2'
import { JobExecutionDetails } from '@/components/v2/JobExecutionDetails'
import { JobStatsChart } from '@/components/v2/JobStatsChart'
import { WebRTCDiagnosticsStrip } from '@/components/v2/WebRTCDiagnosticsStrip'
import { ArtifactLinks } from '@/components/v2/ArtifactLinks'
import { buildEnginePayload, EngineOverridesForm, type EngineOverrides } from '@/components/v2/EngineOverridesForm'
import { ReportPreview } from '@/components/v2/ReportPreview'
import { ScenarioPreview, ScenarioSelect } from '@/components/v2/ScenarioSelect'
import { JobReportsPanel } from '@/views/v2/ReportsV2'
import { Button } from '@/components/ui/button'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Modal } from '@/components/ui/modal'
import { fetchArtifactText } from '@/lib/artifacts'
import { parseCallRecordsWebRTC, type CallRecordLine } from '@/lib/callRecords'
import { validateJobID } from '@/lib/jobId'
import { jobMatchesKindFilter, type JobKindFilter } from '@/lib/jobKind'
import { isProfilePortBlocked, iceServersFromProfile, profileHasWebRTC } from '@/lib/profileHelpers'
import { mergeLiveJobs, parseStatsLines, useLiveJobs } from '@/lib/jobsLive'
import { useToast } from '@/lib/toast'

const STATUS_BADGE: Record<JobStatus, string> = {
  pending: 'bg-muted text-foreground/80',
  running: 'bg-success/15 text-success',
  succeeded: 'bg-success/10 text-success',
  failed: 'bg-destructive/15 text-destructive',
  stopped: 'bg-warning/15 text-warning',
}

export type JobsV2Props = {
  bearer?: string
  busy: boolean
  run: <T>(fn: () => Promise<T>) => Promise<T | undefined>
  errorText?: string | null
  inspectJobId?: string | null
  onInspectJobHandled?: () => void
}

export function JobsV2({ bearer, busy, run, errorText, inspectJobId, onInspectJobHandled }: JobsV2Props) {
  const { toast } = useToast()
  const { liveJobs, connected } = useLiveJobs(bearer)
  const [rows, setRows] = useState<Job[]>([])
  const [servers, setServers] = useState<ServerProfile[]>([])
  const [clients, setClients] = useState<ClientProfile[]>([])
  const [scenarios, setScenarios] = useState<ScenarioMeta[]>([])
  const [builtins, setBuiltins] = useState<BuiltinScenarioMeta[]>([])
  const [startOpen, setStartOpen] = useState(false)
  const [draft, setDraft] = useState<{
    job_id: string
    profile_kind: 'server' | 'client'
    profile_id: string
    scenario_id: string
    sip_capture: boolean
    record_wav: boolean
    record_wav_duplex: boolean
  }>({
    job_id: '',
    profile_kind: 'server',
    profile_id: '',
    scenario_id: '',
    record_wav: false,
 sip_capture: false,
    record_wav_duplex: false,
  })
  const [detail, setDetail] = useState<
    { job: Job; artifacts: JobArtifact[]; recordings: Recording[] } | null
  >(null)
  const [statusFilter, setStatusFilter] = useState<'all' | JobStatus>('all')
  const [kindFilter, setKindFilter] = useState<JobKindFilter>('all')
  const [query, setQuery] = useState('')
  const [engineEnabled, setEngineEnabled] = useState(false)
  const [engineOverrides, setEngineOverrides] = useState<EngineOverrides>({})
  const [detailTab, setDetailTab] = useState<'info' | 'preview'>('info')

  const refresh = useCallback(async () => {
    const [r, s, c, sc, bi] = await Promise.all([
      listJobs({ bearer }, 200),
      listServers({ bearer }),
      listClients({ bearer }),
      listScenarios({ bearer }),
      listBuiltinScenarios({ bearer }).catch(() => ({ scenarios: [] as BuiltinScenarioMeta[] })),
    ])
    setRows(r.jobs ?? [])
    setServers(s.servers ?? [])
    setClients(c.clients ?? [])
    setScenarios(sc.scenarios ?? [])
    setBuiltins(bi.scenarios ?? [])
  }, [bearer])

  useEffect(() => {
    void run(() => refresh())
  }, [run, refresh])

  useEffect(() => {
    if (!inspectJobId) return
    void run(async () => {
      const [d, recs] = await Promise.all([
        getJob(inspectJobId, { bearer }),
        listRecordings(inspectJobId, { bearer }).catch(() => ({ recordings: [] as Recording[] })),
      ])
      setDetail({ ...d, recordings: recs.recordings ?? [] })
      onInspectJobHandled?.()
    })
  }, [inspectJobId, bearer, run, onInspectJobHandled])

  useEffect(() => {
    if (!detail?.job) return
    if (detail.job.status !== 'running' && detail.job.status !== 'pending') return
    const t = setInterval(() => {
      void getJob(detail.job.id, { bearer })
        .then((d) =>
          listRecordings(detail.job.id, { bearer })
            .catch(() => ({ recordings: [] as Recording[] }))
            .then((recs) => setDetail({ ...d, recordings: recs.recordings ?? [] })),
        )
        .catch(() => {})
    }, 3000)
    return () => clearInterval(t)
  }, [detail?.job.id, detail?.job.status, bearer])

  const mergedRows = useMemo(() => mergeLiveJobs(rows, liveJobs), [rows, liveJobs])

  const candidateProfiles = useMemo(
    () => (draft.profile_kind === 'server' ? servers : clients),
    [draft.profile_kind, servers, clients],
  )

  const startBlocked = useMemo(() => {
    if (!draft.profile_id) return { blocked: false, details: [] as string[] }
    return isProfilePortBlocked(draft.profile_kind, draft.profile_id, servers, clients)
  }, [draft.profile_id, draft.profile_kind, servers, clients])

  const scenarioRoleFilter = draft.profile_kind === 'server' ? 'uas' : 'uac'

  const visibleRows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return mergedRows.filter((j) => {
      if (statusFilter !== 'all' && j.status !== statusFilter) return false
      if (!jobMatchesKindFilter(j, kindFilter)) return false
      if (!q) return true
      return (
        j.id.toLowerCase().includes(q) ||
        (j.profile_id ?? '').toLowerCase().includes(q) ||
        (j.scenario_id ?? '').toLowerCase().includes(q) ||
        (j.profile_kind ?? '').toLowerCase().includes(q)
      )
    })
  }, [mergedRows, statusFilter, kindFilter, query])

  const statusCounts = useMemo(() => {
    const out: Record<string, number> = { all: mergedRows.length }
    for (const j of mergedRows) out[j.status] = (out[j.status] ?? 0) + 1
    return out
  }, [mergedRows])

  const jobIdError = useMemo(() => validateJobID(draft.job_id), [draft.job_id])

  const openStartModal = (prefill?: Partial<typeof draft>) => {
    setDraft({
      job_id: '',
      profile_kind: 'server',
      profile_id: '',
      scenario_id: '',
      record_wav: false,
 sip_capture: false,
      record_wav_duplex: false,
      ...prefill,
    })
    setStartOpen(true)
  }

  const onStart = () => {
    if (!draft.profile_id || startBlocked.blocked || jobIdError) return
    void run(async () => {
      await startJob(
        {
          id: draft.job_id.trim() || undefined,
          profile_kind: draft.profile_kind,
          profile_id: draft.profile_id,
          scenario_id: draft.scenario_id || undefined,
          record_wav: draft.record_wav || undefined,
 sip_capture: {enabled:draft.sip_capture,retention_days:7},
          record_wav_duplex: draft.record_wav && draft.record_wav_duplex ? true : undefined,
          engine: engineEnabled ? buildEnginePayload(engineOverrides) : undefined,
        },
        { bearer },
      )
      setStartOpen(false)
      toast('任务已启动', 'success')
      await refresh()
    })
  }

  const onRestart = async (job: Job) => {
    if (!job.profile_id || !job.profile_kind) return
    if (job.profile_kind === 'tool') {
      let args: Record<string, unknown> = {}
      if (job.args_json) {
        try {
          args = JSON.parse(job.args_json) as Record<string, unknown>
        } catch {
          toast('无法解析重启任务参数', 'error')
          return
        }
      }
      void run(async () => {
        await runTool(job.profile_id!, { args }, { bearer })
        toast('工具任务已重新启动', 'success')
        await refresh()
      })
      return
    }
    const capture = await sipTraceRequest<SIPCaptureStatus>(sipTraceURL(job.id,'sip-capture'),bearer).catch(()=>undefined)
    openStartModal({
      sip_capture: capture?.enabled ?? false,
      profile_kind: job.profile_kind as 'server' | 'client',
      profile_id: job.profile_id,
      scenario_id: job.scenario_id ?? '',
    })
  }

  const onStopAllRunning = () => {
    const running = mergedRows.filter((j) => j.status === 'running' || j.status === 'pending')
    if (running.length === 0) return
    if (!window.confirm(`停止 ${running.length} 个运行中的任务？`)) return
    void run(async () => {
      for (const j of running) await stopJob(j.id, { bearer })
      toast('已请求停止全部运行任务', 'info')
      await refresh()
    })
  }

  const onStop = (id: string) => {
    void run(async () => {
      await stopJob(id, { bearer })
      toast('已请求停止任务', 'info')
      await refresh()
    })
  }
  const onDelete = (id: string) => {
    if (!window.confirm(`删除任务 ${id}？`)) return
    void run(async () => {
      await deleteJobV2(id, { bearer })
      toast('任务已删除', 'success')
      await refresh()
    })
  }
  const onInspect = (id: string) => {
    void run(async () => {
      const [d, recs] = await Promise.all([
        getJob(id, { bearer }),
        listRecordings(id, { bearer }).catch(() => ({ recordings: [] as Recording[] })),
      ])
      setDetail({ ...d, recordings: recs.recordings ?? [] })
    })
  }

  const columns: Column<Job>[] = useMemo(
    () => [
      {
        key: 'id',
        header: '任务',
        render: (r) => (
          <button
            type="button"
            onClick={() => onInspect(r.id)}
            className="font-mono text-xs underline-offset-2 hover:underline"
          >
            {r.id.slice(0, 8)}…
          </button>
        ),
      },
      {
        key: 'profile',
        header: '配置',
        render: (r) => (
          <span className="text-xs">
            <code>{displayLabel(r.profile_kind)}</code>
            {r.profile_kind === 'tool' ? (
              <> · {r.profile_id ?? '—'}</>
            ) : (
              <> · {r.profile_id ?? '—'}</>
            )}
          </span>
        ),
      },
      {
        key: 'scenario',
        header: '场景',
        render: (r) =>
          r.profile_kind === 'tool' ? (
            <span className="text-muted-foreground text-xs">—</span>
          ) : r.scenario_id ? (
            <code className="text-xs">{r.scenario_id}</code>
          ) : (
            '—'
          ),
      },
      {
        key: 'status',
        header: '状态',
        render: (r) => (
          <span className="inline-flex items-center gap-1">
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_BADGE[r.status] ?? ''}`}
            >
              {displayLabel(r.status)}
            </span>
            {(() => {
              if (r.profile_kind === 'tool') return null
              const prof =
                r.profile_kind === 'server'
                  ? servers.find((s) => s.id === r.profile_id)
                  : clients.find((c) => c.id === r.profile_id)
              return profileHasWebRTC(prof?.transports) ? (
                <span className="bg-warning/15 text-warning rounded px-1 py-0.5 text-[9px]">WebRTC</span>
              ) : null
            })()}
          </span>
        ),
      },
      {
        key: 'created',
        header: '创建时间',
        render: (r) => formatTimestamp(r.created_at),
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        render: (r) => (
          <div className="flex justify-end gap-1">
            {r.status === 'failed' || r.status === 'stopped' ? (
              <Button type="button" variant="outline" size="xs" onClick={() => onRestart(r)}>
                重新运行
              </Button>
            ) : null}
            {r.status === 'running' || r.status === 'pending' ? (
              <Button type="button" variant="outline" size="xs" onClick={() => onStop(r.id)}>
                停止
              </Button>
            ) : null}
            <Button type="button" variant="destructive" size="xs" onClick={() => onDelete(r.id)}>
              删除
            </Button>
          </div>
        ),
      },
    ],
    [clients, onDelete, onInspect, onRestart, onStop, servers],
  )

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">任务</h2>
          <p className="text-muted-foreground text-xs">
            按客户端或服务端配置独立运行任务，包括压测向导创建的任务。实时状态连接：{connected ? '已连接' : '重新连接中…'}。
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void run(() => refresh())}>
            刷新
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onStopAllRunning}>
            停止全部运行任务
          </Button>
          <Button type="button" size="sm" onClick={() => openStartModal()}>
            + 新建任务
          </Button>
        </div>
      </div>

      {errorText ? (
        <div className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-xs">
          {errorText}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {(['all', 'running', 'pending', 'succeeded', 'failed', 'stopped'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={`rounded px-2 py-0.5 text-[11px] ${
                statusFilter === s
                  ? 'bg-primary text-primary-foreground'
                  : 'border-border bg-background hover:bg-muted border'
              }`}
            >
              {displayLabel(s)} <span className="text-[10px] opacity-75">({statusCounts[s] ?? 0})</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          {(['all', 'load_test', 'tool', 'server', 'client', 'running'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKindFilter(k)}
              className={`rounded px-2 py-0.5 text-[11px] ${
                kindFilter === k
                  ? 'bg-primary/80 text-primary-foreground'
                  : 'border-border bg-background hover:bg-muted border'
              }`}
            >
              {displayLabel(k)}
            </button>
          ))}
        </div>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="按任务 ID、配置或场景筛选…"
          className="h-7 max-w-xs text-xs"
        />
        <span className="text-muted-foreground text-[11px]">
          {visibleRows.length}/{mergedRows.length}
        </span>
      </div>

      <DataTable
        rows={visibleRows}
        columns={columns}
        rowKey={(r) => r.id}
        loading={busy && rows.length === 0}
        empty={rows.length === 0 ? '暂无任务。' : '没有符合筛选条件的任务。'}
      />

      <Modal
        open={startOpen}
        onClose={() => setStartOpen(false)}
        size="md"
        title="新建任务"
        footer={
          <>
            <Button type="button" variant="outline" size="sm" onClick={() => setStartOpen(false)}>
              取消
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={onStart}
              disabled={!draft.profile_id || busy || startBlocked.blocked || !!jobIdError}
            >
              启动
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {startBlocked.blocked ? (
            <div className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-2 py-1.5 text-[11px]">
              端口冲突，请先解决重复监听地址：{' '}
              {startBlocked.details.join(', ')}
            </div>
          ) : null}
          <div>
            <Label className="text-xs">任务 ID（可选）</Label>
            <Input
              value={draft.job_id}
              onChange={(e) => setDraft({ ...draft, job_id: e.target.value })}
              placeholder="留空时自动生成 UUID"
              className={`mt-1 font-mono text-sm ${jobIdError ? 'border-destructive/60' : ''}`}
            />
            {jobIdError ? (
              <p className="text-destructive mt-1 text-[11px]">{jobIdError}</p>
            ) : (
              <p className="text-muted-foreground mt-1 text-[11px]">
                为任务指定易读的 ID，产物保存在 <code>artifacts/jobs/&lt;id&gt;/</code>.
                允许使用字母、数字、 <code>.</code> <code>_</code> <code>-</code> （最多 64 个字符）。
              </p>
            )}
          </div>
          <div>
            <Label className="text-xs">配置类型</Label>
            <div className="mt-1 flex gap-2">
              {(['server', 'client'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setDraft({ ...draft, profile_kind: k, profile_id: '' })}
                  className={`rounded-md px-3 py-1.5 text-xs ${
                    draft.profile_kind === k
                      ? 'bg-primary text-primary-foreground'
                      : 'border-border bg-background hover:bg-muted border'
                  }`}
                >
                  {displayLabel(k)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label className="text-xs">配置</Label>
            <select
              value={draft.profile_id}
              onChange={(e) => setDraft({ ...draft, profile_id: e.target.value })}
              className="border-input bg-background mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
            >
              <option value="">— 请选择 —</option>
              {candidateProfiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id} — {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-xs">覆盖场景（可选）</Label>
            <ScenarioSelect
              value={draft.scenario_id}
              onChange={(scenario_id) => setDraft({ ...draft, scenario_id })}
              scenarios={scenarios}
              builtins={builtins}
              roleFilter={scenarioRoleFilter}
              allowEmpty
              emptyLabel="使用配置默认场景"
            />
            <ScenarioPreview
              scenarioId={draft.scenario_id}
              scenarios={scenarios}
              builtins={builtins}
            />
          </div>
          <div className="flex flex-col gap-1 pt-1">
            <label className="text-foreground flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={draft.record_wav}
                onChange={(e) => setDraft({ ...draft, record_wav: e.target.checked })}
              />
              将收到的 RTP 录制为 WAV（每通一个文件，G.711 解码）
            </label>
            {draft.record_wav ? (
              <label className="text-muted-foreground ml-5 flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={draft.record_wav_duplex}
                  onChange={(e) => setDraft({ ...draft, record_wav_duplex: e.target.checked })}
                />
                双声道（左：发送，右：接收）
              </label>
            ) : null}
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.sip_capture} onChange={e=>setDraft({...draft,sip_capture:e.target.checked})} />开启 SIP 信令采集（UDP，保留 7 天，每 10,000 通一个分片）</label>
          <EngineOverridesForm
            value={engineOverrides}
            onChange={setEngineOverrides}
            enabled={engineEnabled}
            onEnabledChange={setEngineEnabled}
          />
        </div>
      </Modal>

      <Modal
        open={detail !== null}
        onClose={() => {
          setDetail(null)
          setDetailTab('info')
        }}
        size="lg"
        title={detail ? `任务 · ${detail.job.id}` : '任务'}
      >
        {detail ? (
          <div className="flex flex-col gap-3 text-xs">
            <div className="flex gap-1">
              {(['info', 'preview'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setDetailTab(t)}
                  className={`rounded px-2 py-0.5 text-[11px] ${detailTab === t ? 'bg-primary text-primary-foreground' : 'border border-border'}`}
                >
                  {t === 'info' ? '详情' : '报告预览'}
                </button>
              ))}
            </div>
            {detailTab === 'preview' ? (
              <ReportPreview jobId={detail.job.id} bearer={bearer} />
            ) : (
              <>
            <DescList
              rows={[
                ['状态', displayLabel(detail.job.status)],
                ['配置', `${displayLabel(detail.job.profile_kind)} / ${detail.job.profile_id ?? '—'}`],
                ['场景', detail.job.profile_kind === 'tool' ? '—' : (detail.job.scenario_id ?? '—')],
                ['创建时间', formatTimestamp(detail.job.created_at)],
                ['开始时间', detail.job.started_at ? formatTimestamp(detail.job.started_at) : '—'],
                ['结束时间', detail.job.finished_at ? formatTimestamp(detail.job.finished_at) : '—'],
                ['退出码', detail.job.exit_code ?? '—'],
                ['PID', detail.job.pid ?? '—'],
                ['产物目录', detail.job.artifacts_dir ?? '—'],
                ['错误', detail.job.error || '—'],
              ]}
            />
            <div>
              <div className="text-muted-foreground mb-1 font-medium">参数</div>
              <pre className="bg-muted/40 max-h-32 overflow-auto rounded p-2 font-mono text-[11px]">
                {displayJobArgs(detail.job.args_json)}
              </pre>
            </div>
            <JobExecutionDetails key={detail.job.id} job={detail.job} artifacts={detail.artifacts} bearer={bearer} />
            <JobReportsPanel
              jobId={detail.job.id}
              artifacts={detail.artifacts}
              bearer={bearer}
              run={run}
              onGenerated={() => onInspect(detail.job.id)}
            />
            <div>
              <div className="text-muted-foreground mb-1 font-medium">全部产物（{detail.artifacts.length}）</div>
              <ArtifactLinks jobId={detail.job.id} artifacts={detail.artifacts} bearer={bearer} />
            </div>
            <JobStatsTail job={detail.job} bearer={bearer} />
            <div>
              <div className="text-muted-foreground mb-1 font-medium">
                录音（{detail.recordings.length}）
              </div>
              {detail.recordings.length === 0 ? (
                <p className="text-muted-foreground">
                  暂无 WAV 文件。创建任务时可开启逐通话录音。
                </p>
              ) : (
                <ul className="space-y-2">
                  {detail.recordings.map((r) => (
                    <li key={r.name} className="flex flex-wrap items-center gap-3 font-mono">
                      <span className="min-w-[8rem]">{r.name}</span>
                      <span className="text-muted-foreground">{r.size_bytes} B</span>
                      <audio
                        controls
                        className="h-7"
                        src={recordingURL(detail.job.id, r.name, bearer)}
                      />
                      <a
                        href={recordingURL(detail.job.id, r.name, bearer)}
                        download={r.name}
                        className="bg-background border-border hover:bg-muted rounded-md border px-2 py-0.5 text-[11px]"
                      >
                        下载
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {detail.job.status === 'failed' || detail.job.status === 'stopped' ? (
              <Button type="button" size="sm" variant="outline" onClick={() => onRestart(detail.job)}>
                {detail.job.profile_kind === 'tool' ? '重新运行工具任务' : '使用相同配置重新运行'}
              </Button>
            ) : null}
              </>
            )}
          </div>
        ) : null}
      </Modal>
    </section>
  )
}

function JobStatsTail({ job, bearer }: { job: Job; bearer?: string }) {
  const [lines, setLines] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [iceServers, setIceServers] = useState<string[]>([])
  const [webrtcProfile, setWebrtcProfile] = useState(false)
  const [callRecords, setCallRecords] = useState<CallRecordLine[]>([])
  const tailN = 25

  useEffect(() => {
    if (!job.profile_id || !job.profile_kind) {
      setIceServers([])
      setWebrtcProfile(false)
      return
    }
    void (async () => {
      try {
        if (job.profile_kind === 'server') {
          const r = await listServers({ bearer })
          const p = (r.servers ?? []).find((s) => s.id === job.profile_id)
          setWebrtcProfile(profileHasWebRTC(p?.transports))
          setIceServers(iceServersFromProfile(p?.transports))
        } else if (job.profile_kind === 'client') {
          const r = await listClients({ bearer })
          const p = (r.clients ?? []).find((c) => c.id === job.profile_id)
          setWebrtcProfile(profileHasWebRTC(p?.transports))
          setIceServers(iceServersFromProfile(p?.transports))
        }
      } catch {
        setIceServers([])
        setWebrtcProfile(false)
      }
    })()
  }, [job.profile_id, job.profile_kind, bearer])

  useEffect(() => {
    let cancelled = false
    const ctrl = new AbortController()
    const follow = job.status === 'running' || job.status === 'pending'
    const url = jobEventsURL(job.id, bearer, { tail: tailN, follow })
    fetch(url, { signal: ctrl.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const reader = res.body?.getReader()
        if (!reader) throw new Error('服务器未返回响应内容')
        const dec = new TextDecoder()
        let buf = ''
        const pump = (): Promise<void> =>
          reader.read().then(({ done, value }) => {
            if (cancelled || done) return
            buf += dec.decode(value, { stream: true })
            const parts = buf.split('\n')
            buf = parts.pop() ?? ''
            if (parts.length > 0) {
              setLines((prev) => {
                const next = [...prev, ...parts.filter((p) => p.length > 0)]
                return next.length > 200 ? next.slice(next.length - 200) : next
              })
            }
            return pump()
          })
        return pump()
      })
      .catch((err) => {
        if (cancelled) return
        if (err.name === 'AbortError') return
        setError(String(err.message ?? err))
      })
    return () => {
      cancelled = true
      ctrl.abort()
    }
  }, [job.id, bearer, job.status])

  const chartPoints = useMemo(() => parseStatsLines(lines), [lines])
  const showWebRTC = webrtcProfile || lines.some((l) => /webrtc/i.test(l))

  useEffect(() => {
    if (!showWebRTC) return
    void fetchArtifactText(job.id, 'call_records', bearer)
      .then((text) => setCallRecords(parseCallRecordsWebRTC(text)))
      .catch(() => setCallRecords([]))
  }, [job.id, bearer, job.status, showWebRTC])

  return (
    <div>
      <div className="text-muted-foreground mb-1 font-medium">运行事件</div>
      {showWebRTC ? <WebRTCDiagnosticsStrip lines={lines} iceServers={iceServers} callRecords={callRecords} /> : null}
      {job ? <JobProgress lines={lines} job={job} /> : null}
      <JobStatsChart points={chartPoints} />
      {error ? <p className="text-destructive mt-1 text-[11px]">{error}</p> : null}
      <pre className="bg-muted/40 mt-2 max-h-48 overflow-auto rounded p-2 font-mono text-[10px] whitespace-pre-wrap">
        {lines.length === 0 ? '等待执行进程…' : lines.slice(-tailN).join('\n')}
      </pre>
    </div>
  )
}

function DescList({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-3 gap-x-3 gap-y-1">
      {rows.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="col-span-2 font-mono break-all">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  )
}
