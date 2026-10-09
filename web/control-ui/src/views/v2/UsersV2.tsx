import { formatTimestamp } from '@/lib/time'
import { displayLabel } from '@/lib/displayLabel'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { createUser, deleteUser, listUsers, updateUser, type User } from '@/api/v2'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Modal } from '@/components/ui/modal'
import { useToast } from '@/lib/toast'

export type UsersV2Props = {
  bearer?: string
  busy: boolean
  run: <T>(fn: () => Promise<T>) => Promise<T | undefined>
  errorText?: string | null
}

type CreateDraft = { username: string; password: string; role: string }
type EditDraft = { id: number; username: string; password: string; role: string }

export function UsersV2({ bearer, busy, run, errorText }: UsersV2Props) {
  const { toast } = useToast()
  const [users, setUsers] = useState<User[]>([])
  const [createDraft, setCreateDraft] = useState<CreateDraft | null>(null)
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null)
  const [unauthorized, setUnauthorized] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const r = await listUsers({ bearer })
      setUsers(r.users ?? [])
      setUnauthorized(false)
    } catch (e: unknown) {
      if (e && typeof e === 'object' && 'status' in e && (e as { status: number }).status === 404) {
        setUnauthorized(true)
      } else {
        throw e
      }
    }
  }, [bearer])

  useEffect(() => {
    void run(() => refresh())
  }, [run, refresh])

  const onCreate = () => {
    if (!createDraft) return
    void run(async () => {
      await createUser(
        { username: createDraft.username, password: createDraft.password, role: createDraft.role || undefined },
        { bearer },
      )
      setCreateDraft(null)
      toast('用户已创建', 'success')
      await refresh()
    })
  }

  const onSaveEdit = () => {
    if (!editDraft) return
    void run(async () => {
      await updateUser(
        editDraft.id,
        { password: editDraft.password || undefined, role: editDraft.role || undefined },
        { bearer },
      )
      setEditDraft(null)
      toast('用户已更新', 'success')
      await refresh()
    })
  }

  const onDelete = (u: User) => {
    if (!window.confirm(`删除用户 "${u.username}"?`)) return
    void run(async () => {
      await deleteUser(u.id, { bearer })
      toast('用户已删除', 'success')
      await refresh()
    })
  }

  const columns: Column<User>[] = useMemo(
    () => [
      { key: 'id', header: 'ID', render: (r) => <code className="text-xs">{r.id}</code> },
      { key: 'username', header: "用户名", render: (r) => r.username },
      { key: 'role', header: "角色", render: (r) => displayLabel(r.role) },
      { key: 'created', header: "创建时间", render: (r) => formatTimestamp(r.created_at) },
      {
        key: 'actions',
        header: '',
        align: 'right',
        render: (r) => (
          <div className="flex justify-end gap-1">
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => setEditDraft({ id: r.id, username: r.username, password: '', role: r.role || 'admin' })}
            >
              编辑
            </Button>
            <Button type="button" variant="destructive" size="xs" onClick={() => onDelete(r)}>
              删除
            </Button>
          </div>
        ),
      },
    ],
    [onDelete],
  )

  if (unauthorized) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>用户</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-xs">
            用户管理需要 <code>auth.type: internal</code>。服务器当前未启用用户管理接口。
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">用户</h2>
          <p className="text-muted-foreground text-xs">
            可登录控制台的管理账号（<code>users</code> 表，存储于{' '}
            <code>settings.sqlite</code>）。审计记录可在 <strong>审计</strong> 页面查看。
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void run(() => refresh())}>
            刷新
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => setCreateDraft({ username: '', password: '', role: 'admin' })}
          >
            + 新建用户
          </Button>
        </div>
      </div>

      {errorText ? (
        <div className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-xs">
          {errorText}
        </div>
      ) : null}

      <DataTable
        rows={users}
        columns={columns}
        rowKey={(r) => String(r.id)}
        loading={busy && users.length === 0}
        empty="暂无用户。"
      />

      <Modal
        open={createDraft !== null}
        onClose={() => setCreateDraft(null)}
        size="sm"
        title="新建用户"
        footer={
          <>
            <Button type="button" variant="outline" size="sm" onClick={() => setCreateDraft(null)}>
              取消
            </Button>
            <Button type="button" size="sm" onClick={onCreate} disabled={busy}>
              创建
            </Button>
          </>
        }
      >
        {createDraft ? (
          <div className="flex flex-col gap-3">
            <div>
              <Label className="text-xs">用户名</Label>
              <Input
                value={createDraft.username}
                onChange={(e) => setCreateDraft({ ...createDraft, username: e.target.value })}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">密码（至少 8 个字符）</Label>
              <Input
                type="password"
                value={createDraft.password}
                onChange={(e) => setCreateDraft({ ...createDraft, password: e.target.value })}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">角色</Label>
              <Input
                value={createDraft.role}
                onChange={(e) => setCreateDraft({ ...createDraft, role: e.target.value })}
                className="mt-1"
                placeholder="admin"
              />
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={editDraft !== null}
        onClose={() => setEditDraft(null)}
        size="sm"
        title={editDraft ? `编辑 ${editDraft.username}` : 'Edit'}
        footer={
          <>
            <Button type="button" variant="outline" size="sm" onClick={() => setEditDraft(null)}>
              取消
            </Button>
            <Button type="button" size="sm" onClick={onSaveEdit} disabled={busy}>
              保存
            </Button>
          </>
        }
      >
        {editDraft ? (
          <div className="flex flex-col gap-3">
            <div>
              <Label className="text-xs">新密码（留空表示不修改）</Label>
              <Input
                type="password"
                value={editDraft.password}
                onChange={(e) => setEditDraft({ ...editDraft, password: e.target.value })}
                className="mt-1"
                placeholder="至少 8 个字符"
              />
            </div>
            <div>
              <Label className="text-xs">角色</Label>
              <Input
                value={editDraft.role}
                onChange={(e) => setEditDraft({ ...editDraft, role: e.target.value })}
                className="mt-1"
              />
            </div>
          </div>
        ) : null}
      </Modal>
    </section>
  )
}
