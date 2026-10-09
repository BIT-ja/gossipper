import { cn } from '@/lib/utils'

export type ThemeMode = 'light' | 'dark'

type Props = {
  value: ThemeMode
  onChange: (mode: ThemeMode) => void
  className?: string
}

/** Segmented control: light vs dark (sets `html.dark` via parent). */
export function ThemeToggle({ value, onChange, className }: Props) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <span className="text-muted-foreground text-xs font-medium">主题</span>
      <div
        className="border-border bg-muted/30 inline-flex rounded-md border p-0.5"
        role="group"
        aria-label="颜色主题"
      >
        <button
          type="button"
          onClick={() => onChange('light')}
          className={cn(
            'rounded px-3 py-1.5 text-xs font-medium transition-colors',
            value === 'light'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          浅色
        </button>
        <button
          type="button"
          onClick={() => onChange('dark')}
          className={cn(
            'rounded px-3 py-1.5 text-xs font-medium transition-colors',
            value === 'dark'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          深色
        </button>
      </div>
    </div>
  )
}
