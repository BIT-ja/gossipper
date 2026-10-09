import { AuditLogPanel } from '@/components/v2/AuditLogPanel'

export type AuditV2Props = {
  bearer?: string
}

export function AuditV2({ bearer }: AuditV2Props) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-semibold">审计</h2>
        <p className="text-muted-foreground text-xs">
          配置、场景、任务和用户的变更操作记录于{' '}
          <code>settings.sqlite</code>.
        </p>
      </div>
      <AuditLogPanel bearer={bearer} autoRefresh />
    </section>
  )
}
