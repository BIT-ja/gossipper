import { useCallback, useEffect, useState } from 'react'

import { getHealthV2, getSettingsV2, rotateJwtSecret, changeMyPassword, type HealthV2, type SettingsV2 as SettingsResp } from '@/api/v2'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ThemeToggle, type ThemeMode } from '@/components/ThemeToggle'
import type { NavId } from '@/lib/routing'

export type SettingsV2Props = {
  bearer?: string
  theme: ThemeMode
  onThemeChange: (m: ThemeMode) => void
  onSignOut?: () => void
  authKind: 'none' | 'internal' | null
  isAdmin?: boolean
  onNavigate?: (nav: NavId) => void
}

export function SettingsV2({ bearer, theme, onThemeChange, onSignOut, authKind, isAdmin, onNavigate }: SettingsV2Props) {
  const [health, setHealth] = useState<HealthV2 | null>(null)
  const [runtime, setRuntime] = useState<SettingsResp | null>(null)
  const [rotated, setRotated] = useState<{ secret: string; warning: string } | null>(null)
  const [rotating, setRotating] = useState(false)
  const [rotateError, setRotateError] = useState<string | null>(null)
  const [curPass, setCurPass] = useState('')
  const [newPass, setNewPass] = useState('')
  const [passMsg, setPassMsg] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    try {
      setHealth(await getHealthV2({ bearer }))
    } catch {
      setHealth(null)
    }
    try {
      setRuntime(await getSettingsV2({ bearer }))
    } catch {
      setRuntime(null)
    }
  }, [bearer])
  useEffect(() => {
    void refresh()
  }, [refresh])

  const onRotate = async () => {
    if (!window.confirm(
      '是否轮换 JWT 签名密钥？所有已登录会话（包括当前会话）都将' +
        '失效并需要重新登录。',
    )) return
    setRotating(true)
    setRotateError(null)
    try {
      const res = await rotateJwtSecret({ bearer })
      setRotated({ secret: res.jwt_secret, warning: res.warning })
    } catch (err) {
      setRotateError(err instanceof Error ? err.message : String(err))
    } finally {
      setRotating(false)
    }
  }

  const onChangePassword = async () => {
    setPassMsg(null)
    try {
      await changeMyPassword({ current_password: curPass, new_password: newPass }, { bearer })
      setPassMsg('密码已更新')
      setCurPass('')
      setNewPass('')
    } catch (err) {
      setPassMsg(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <Card>
        <CardHeader>
          <CardTitle>系统</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted-foreground">API 状态</dt>
            <dd>{health?.status ?? '—'}</dd>
            <dt className="text-muted-foreground">认证方式</dt>
            <dd>{health?.auth ?? authKind ?? '—'}</dd>
            <dt className="text-muted-foreground">版本</dt>
            <dd>{health?.version ?? '—'}</dd>
          </dl>
          <div className="mt-3 flex gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => void refresh()}>
              刷新
            </Button>
            {authKind === 'internal' && onSignOut ? (
              <Button type="button" size="sm" variant="destructive" onClick={onSignOut}>
                退出登录
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {runtime ? (
        <Card>
          <CardHeader>
            <CardTitle>运行环境</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted-foreground">界面数据目录</dt>
              <dd className="font-mono break-all">{runtime.ui_data_dir}</dd>
              <dt className="text-muted-foreground">场景历史保留数量</dt>
              <dd>{runtime.scenario_history_keep === 0 ? 'unlimited' : runtime.scenario_history_keep}</dd>
              <dt className="text-muted-foreground">磁盘使用量</dt>
              <dd>
                {runtime.disk_usage_bytes != null
                  ? `${(runtime.disk_usage_bytes / (1024 * 1024)).toFixed(2)} MiB`
                  : '—'}
                {runtime.disk_usage_bytes != null && runtime.disk_usage_bytes > 512 * 1024 * 1024 ? (
                  <button type="button" className="text-primary ml-2 underline" onClick={() => onNavigate?.('jobs')}>
                    管理任务
                  </button>
                ) : null}
              </dd>
            </dl>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>外观</CardTitle>
        </CardHeader>
        <CardContent>
          <ThemeToggle value={theme} onChange={onThemeChange} />
        </CardContent>
      </Card>

      {authKind === 'internal' ? (
        <Card>
          <CardHeader>
            <CardTitle>修改密码</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-xs">
            <div>
              <Label className="text-[10px]">当前密码</Label>
              <Input type="password" className="mt-1" value={curPass} onChange={(e) => setCurPass(e.target.value)} />
            </div>
            <div>
              <Label className="text-[10px]">新密码（至少 8 个字符）</Label>
              <Input type="password" className="mt-1" value={newPass} onChange={(e) => setNewPass(e.target.value)} />
            </div>
            <Button type="button" size="sm" className="self-start" onClick={() => void onChangePassword()}>
              更新密码
            </Button>
            {passMsg ? <p className="text-muted-foreground">{passMsg}</p> : null}
          </CardContent>
        </Card>
      ) : null}

      {authKind === 'internal' && isAdmin !== false ? (
        <Card>
          <CardHeader>
            <CardTitle>JWT 签名密钥</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-xs">
              轮换会话令牌的 HMAC 签名密钥。所有已登录用户（包括当前用户）都需要重新登录。
            </p>
            <div className="mt-2">
              <Button type="button" size="sm" variant="destructive" disabled={rotating} onClick={() => void onRotate()}>
                {rotating ? 'Rotating…' : '立即轮换'}
              </Button>
            </div>
            {rotateError ? (
              <p className="text-destructive mt-2 text-xs">{rotateError}</p>
            ) : null}
            {rotated ? (
              <div className="border-border bg-muted/40 mt-3 rounded-md border p-2 text-xs">
                <div className="text-foreground font-medium">新密钥（请立即保存）：</div>
                <pre className="mt-1 font-mono text-[11px] break-all whitespace-pre-wrap">
                  {rotated.secret}
                </pre>
                <p className="text-muted-foreground mt-1">{rotated.warning}</p>
                {onSignOut ? (
                  <Button type="button" size="xs" className="mt-2" onClick={onSignOut}>
                    立即退出登录
                  </Button>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>功能进展</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="text-muted-foreground space-y-1 text-xs">
            <li>
              <strong className="text-foreground">阶段 0 ✓</strong> — 任务调度、UI 存储与 SQLite 迁移， <code>/api/v2</code>.
            </li>
            <li>
              <strong className="text-foreground">阶段 1 ✓</strong> — 配置、场景、任务及媒体管理界面。
            </li>
            <li>
              <strong className="text-foreground">阶段 2 ✓</strong> — 独立任务进程执行。
            </li>
            <li>
              <strong className="text-foreground">阶段 3 ✓</strong> — 在任务详情中展示录音产物。
            </li>
            <li>
              <strong className="text-foreground">阶段 4 ✓</strong> — WS/WSS 模块与引擎集成（<code>w1/wn/ws1/wsn</code>).
            </li>
            <li>
              <strong className="text-foreground">阶段 4.2 ✓</strong> — 逐通话 WebRTC 桥接、统计、WAV 与通话记录；内置 <code>webrtc_uac</code> / <code>webrtc_uas</code> 场景（
              <code>docs/webrtc.md</code>).
            </li>
            <li>
              <strong className="text-foreground">阶段 5 ✓</strong> — 用户管理、审计日志和界面文档。
            </li>
            <li>
              <strong className="text-foreground">阶段 5.1 ✓</strong> — 实时 WS、JSONL 事件流、服务端与客户端启停、媒体校验及 JWT 轮换。
            </li>
            <li>
              <strong className="text-foreground">阶段 5.2 ✓</strong> — 审计导航、内置场景、端口冲突检查、实时任务、场景版本对比和媒体引用。
            </li>
          </ul>
        </CardContent>
      </Card>
    </section>
  )
}
