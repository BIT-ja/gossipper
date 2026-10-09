import { useEffect, useRef, type ReactNode } from 'react'

export type ModalProps = {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'trace'
}

const SIZE: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'max-w-md',
  md: 'max-w-xl',
  lg: 'max-w-3xl',
  xl: 'max-w-5xl',
  trace: 'max-w-none w-[94vw]',
}

export function Modal({ open, onClose, title, description, children, footer, size = 'md' }: ModalProps) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const previous=document.activeElement as HTMLElement|null
    const selector='button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]'
    const timer=window.setTimeout(()=>box.current?.querySelector<HTMLElement>(selector)?.focus(),0)
    const onKey = (e: KeyboardEvent) => {
      if (Array.from(document.querySelectorAll('[role=dialog]')).at(-1) !== box.current || !box.current?.contains(document.activeElement)) return
      if (e.key === 'Escape') {e.stopImmediatePropagation();onClose()}
      if(e.key==='Tab'){
        const nodes=Array.from(box.current.querySelectorAll<HTMLElement>(selector)).filter(n=>n.getClientRects().length)
        const first=nodes[0],last=nodes.at(-1)
        if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}
        else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {window.clearTimeout(timer);window.removeEventListener('keydown',onKey);previous?.focus()}
  }, [open])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`bg-card text-card-foreground border-border relative z-10 m-4 flex max-h-[90vh] w-full flex-col overflow-hidden rounded-lg border shadow-xl ${SIZE[size]}`}
      >
        <header className="border-border flex shrink-0 items-start justify-between gap-4 border-b px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
            {description ? (
              <p className="text-muted-foreground mt-0.5 text-xs">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground -mr-1 -mt-1 rounded-md px-2 py-1 text-xs"
            aria-label="关闭"
          >
            ✕
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">{children}</div>
        {footer ? (
          <footer className="border-border flex shrink-0 items-center justify-end gap-2 border-t bg-muted/30 px-4 py-3">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  )
}
