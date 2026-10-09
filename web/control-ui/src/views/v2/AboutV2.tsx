import { useEffect, useState } from 'react'

import { getHealthV2, type HealthV2 } from '@/api/v2'

const REPO_URL = 'https://github.com/sipcapture/gossipper'
const HOMER_URL = 'https://github.com/sipcapture/homer'

const FEATURES: { title: string; body: string }[] = [
  {
    title: "SIP 压测与 UAS 引擎",
    body: '支持 UDP、TCP、TLS 及 WebSocket 的 UAC/UAS 配置。每个配置可包含多个监听地址，支持自定义场景、逐通话媒体（PCMU/PCMA）及 SDES SRTP。',
  },
  {
    title: "管理控制台（API v2）",
    body: '界面通过 /api/v2/* 提供管理功能。配置、场景和媒体分别存储在 profiles/、scenarios/ 和 media/，任务与审计日志存储在 settings.sqlite。',
  },
  {
    title: "任务管理与调度",
    body: '每次启动均创建独立任务子进程，保存输出日志，并在界面提供任务状态与录音。',
  },
  {
    title: "可观测性",
    body: '支持逐任务 WAV 录音、汇总及统计，提供 HEP 转发（HOMER）及可选 OTLP 事件导出，可在任务页面查看。',
  },
  {
    title: "认证与审计",
    body: '支持 SQLite 与 JWT 内部用户认证。变更操作记录在 audit_log 表，可在审计页面查看。',
  },
]

const BUILTIN_SCENARIOS = [
  'uac',
  'uas',
  'management',
  'invite_media',
  'invite_media_early',
  'invite_media_savpf',
  'invite_media_early_180',
]

export type AboutV2Props = {
  bearer?: string
}

export function AboutV2({ bearer }: AboutV2Props) {
  const [health, setHealth] = useState<HealthV2 | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const h = await getHealthV2({ bearer })
        if (!cancelled) setHealth(h)
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [bearer])

  return (
    <section className="flex max-w-3xl flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h2 className="text-base font-semibold tracking-tight">关于 Gossipper</h2>
        <p className="text-muted-foreground text-xs leading-relaxed">
          Gossipper 是 SIP 压测与通话模拟工具，支持场景回放、运维演练及集成测试。支持 UDP / TCP / TLS / WS / WSS 和真实 RTP 媒体流，可在本控制台查看结果，并通过 HEP 上报到{' '}
          <a
            href={HOMER_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="text-primary underline-offset-2 hover:underline"
          >
            HOMER
          </a>
          .
        </p>
      </header>

      <div className="border-border bg-card grid grid-cols-1 gap-2 rounded-md border p-3 sm:grid-cols-2">
        <Kv k="Version" v={health?.version ?? '…'} />
        <Kv k="认证方式" v={health?.auth ?? '…'} />
        <Kv k="API" v="/api/v2/* (admin console)" />
        <Kv k="Status" v={err ? `error: ${err}` : health?.status ?? '…'} />
      </div>

      <div className="border-border bg-card rounded-md border p-3">
        <h3 className="mb-1 text-sm font-medium">内置场景</h3>
        <p className="text-muted-foreground mb-2 text-xs">
          引擎内置 XML（只读），可在配置和任务表单中与自定义场景一同选择。
        </p>
        <div className="flex flex-wrap gap-1">
          {BUILTIN_SCENARIOS.map((id) => (
            <code key={id} className="bg-muted rounded px-1.5 py-0.5 text-[10px]">
              {id}
            </code>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {FEATURES.map((f) => (
          <article
            key={f.title}
            className="border-border bg-card flex flex-col gap-1 rounded-md border p-3"
          >
            <h3 className="text-sm font-medium">{f.title}</h3>
            <p className="text-muted-foreground text-xs leading-relaxed">{f.body}</p>
          </article>
        ))}
      </div>

      <footer className="text-muted-foreground flex flex-wrap items-center gap-3 text-[11px]">
        <a
          href={REPO_URL}
          target="_blank"
          rel="noreferrer noopener"
          className="text-primary underline-offset-2 hover:underline"
        >
          github.com/sipcapture/gossipper
        </a>
        <span>·</span>
        <a
          href={`${REPO_URL}/blob/main/CHANGELOG.md`}
          target="_blank"
          rel="noreferrer noopener"
          className="text-primary underline-offset-2 hover:underline"
        >
          更新日志
        </a>
        <span>·</span>
        <a
          href={`${REPO_URL}/tree/main/docs`}
          target="_blank"
          rel="noreferrer noopener"
          className="text-primary underline-offset-2 hover:underline"
        >
          文档
        </a>
        <span>·</span>
        <a
          href={`${REPO_URL}/blob/main/LICENSE`}
          target="_blank"
          rel="noreferrer noopener"
          className="text-primary underline-offset-2 hover:underline"
        >
          AGPL-3.0
        </a>
      </footer>
    </section>
  )
}

function Kv({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-xs">
      <span className="text-muted-foreground">{k}</span>
      <code className="text-foreground/90 text-[11px]">{v}</code>
    </div>
  )
}
