import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'

/** Shared admin UI primitives — Sonoran cockpit style. */

export function Badge({ label, cls }: { label: string; cls: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-[11px] tracking-wide ${cls}`}
    >
      {label}
    </span>
  )
}

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-edge bg-panel ${className}`}>{children}</div>
  )
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  disabled,
  type = 'button',
  className = '',
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'ghost' | 'danger'
  disabled?: boolean
  type?: 'button' | 'submit'
  className?: string
}) {
  const base =
    'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-40'
  const styles = {
    primary:
      'bg-terra text-ink hover:bg-terra-deep hover:text-bone shadow-[0_0_24px_-8px_var(--color-terra)]',
    ghost: 'border border-edge2 bg-panel2 text-bone hover:border-fog',
    danger: 'border border-alert/40 bg-alert/10 text-alert hover:bg-alert/20',
  }
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${styles[variant]} ${className}`}>
      {children}
    </button>
  )
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-fog">
      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-edge2 border-t-terra" />
      {label && <span className="font-mono text-xs tracking-wide">{label}</span>}
    </div>
  )
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-alert/40 bg-alert/10 px-4 py-3 text-sm text-alert">
      {message}
    </div>
  )
}

export function Shell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  return (
    <div className="grain min-h-screen">
      <header className="sticky top-0 z-40 border-b border-edge bg-ink/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/" className="group flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-terra font-display text-lg font-bold text-ink transition-transform group-hover:-rotate-6">
              G
            </span>
            <div>
              <div className="font-display text-base font-bold tracking-tight">
                Greenscape <span className="text-terra">AI Ops</span>
              </div>
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-fog">
                Proposal Engine · Phoenix AZ
              </div>
            </div>
          </Link>
          <nav className="flex items-center gap-1 font-mono text-xs">
            <Link
              to="/"
              className={`rounded-md px-3 py-1.5 transition-colors ${
                pathname === '/' ? 'bg-panel2 text-bone' : 'text-fog hover:text-bone'
              }`}
            >
              Pipeline
            </Link>
            <a
              href="https://github.com/cero753/greenscape-ai-ops"
              target="_blank"
              rel="noreferrer"
              className="rounded-md px-3 py-1.5 text-fog transition-colors hover:text-bone"
            >
              GitHub ↗
            </a>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
      <footer className="mx-auto max-w-6xl px-6 pb-8 pt-4 font-mono text-[11px] text-fog/60">
        Demo build for isthispossible.ai — simulated GHL intake · Claude-priced proposals ·
        human-approved before send.
      </footer>
    </div>
  )
}
