/**
 * Small presentational primitives shared across guest pages and the console.
 * No hooks here, so every one of them also works in server components.
 */
import * as React from "react"
import { AlertTriangle, CheckCircle2, Info, Loader2, Sparkles, XCircle, type LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/** Visual tones shared by StatTile, Callout and IconTile. */
export type Tone = "neutral" | "brand" | "highlight" | "success" | "warning" | "danger" | "info" | "agent"

/** Soft fill + its AA text colour for each tone. */
const TONE_SOFT: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  brand: "bg-primary-soft text-primary-soft-foreground",
  highlight: "bg-highlight-soft text-highlight-soft-foreground",
  success: "bg-success-soft text-success-soft-foreground",
  warning: "bg-warning-soft text-warning-soft-foreground",
  danger: "bg-destructive-soft text-destructive-soft-foreground",
  info: "bg-info-soft text-info-soft-foreground",
  // AI features only.
  agent: "bg-agent-soft text-agent-soft-foreground",
}

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("skeleton h-4 w-full", className)} aria-hidden {...props} />
}

/** Inline spinner; pass a `label` when it is the only sign that something is loading. */
export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <span role={label ? "status" : undefined} className="inline-flex items-center">
      <Loader2 className={cn("size-4 animate-spin text-muted-foreground", className)} aria-hidden />
      {label && <span className="sr-only">{label}</span>}
    </span>
  )
}

export function Kbd({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-border bg-surface-sunken px-1 font-sans text-2xs font-medium text-muted-foreground shadow-[inset_0_-1px_0_hsl(var(--border))]",
        className
      )}
      {...props}
    />
  )
}

// Identity colours for initials. Deliberately not status tones (green/amber/red),
// brass or the agent violet, so an avatar never reads as a state or a mark.
const AVATAR_TONES = [
  "bg-primary-soft text-primary-soft-foreground",
  "bg-info-soft text-info-soft-foreground",
  "bg-secondary text-secondary-foreground",
]

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  return ((parts[0][0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase()
}

const AVATAR_SIZES = {
  xs: "size-5 text-[10px]",
  sm: "size-7 text-2xs",
  md: "size-9 text-xs",
  lg: "size-12 text-sm",
} as const

export function Avatar({
  name,
  className,
  size = "md",
}: {
  name: string
  className?: string
  size?: keyof typeof AVATAR_SIZES
}) {
  const tone = AVATAR_TONES[Array.from(name).reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_TONES.length]
  const text = size === "xs" ? initials(name).slice(0, 1) : initials(name)
  return (
    <span
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold leading-none",
        tone,
        AVATAR_SIZES[size],
        className
      )}
      aria-hidden
    >
      {text}
    </span>
  )
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  children,
}: {
  icon?: LucideIcon
  title: React.ReactNode
  /** Say what to do next, not just that it's empty. */
  description?: React.ReactNode
  action?: React.ReactNode
  className?: string
  children?: React.ReactNode
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      {Icon && (
        <div className="mb-4 flex size-12 items-center justify-center rounded-2xl border bg-surface-sunken text-muted-foreground">
          <Icon className="size-6" aria-hidden />
        </div>
      )}
      <p className="text-base font-semibold tracking-tight">{title}</p>
      {description && <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground">{description}</p>}
      {children}
      {action && <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  )
}

/** A rounded square holding an icon, tinted with a tone (decorative). */
export function IconTile({
  icon: Icon,
  tone = "neutral",
  size = "md",
  className,
}: {
  icon: LucideIcon
  tone?: Tone
  size?: "sm" | "md" | "lg"
  className?: string
}) {
  const sizes = { sm: "size-8 rounded-lg [&_svg]:size-4", md: "size-9 rounded-xl [&_svg]:size-[18px]", lg: "size-11 rounded-xl [&_svg]:size-5" }
  return (
    <span className={cn("flex shrink-0 items-center justify-center", sizes[size], TONE_SOFT[tone], className)} aria-hidden>
      <Icon />
    </span>
  )
}

export function StatTile({
  label,
  value,
  hint,
  icon: Icon,
  tone = "neutral",
  onClick,
  active,
  className,
}: {
  label: string
  value: React.ReactNode
  hint?: React.ReactNode
  icon?: LucideIcon
  /**
   * Icon tint. Keep it neutral unless the number signals something
   * (success/warning/danger); `agent` is for AI-generated figures only.
   */
  tone?: Tone
  onClick?: () => void
  active?: boolean
  className?: string
}) {
  const interactive = Boolean(onClick)
  const Comp = interactive ? "button" : "div"
  return (
    <Comp
      {...(interactive ? { type: "button" as const, onClick, "aria-pressed": active } : {})}
      className={cn(
        "group flex w-full min-w-0 items-start justify-between gap-3 rounded-2xl border bg-card p-4 text-left shadow-xs transition-[border-color,box-shadow,transform] duration-150",
        interactive &&
          "hover:-translate-y-0.5 hover:border-border-strong/40 hover:shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        active && "border-primary/60 bg-primary-soft/40 shadow-soft ring-1 ring-primary/30",
        className
      )}
    >
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold leading-8 tracking-tight tabular">{value}</p>
        {hint ? (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</p>
        ) : hint !== undefined ? (
          // An empty hint (still loading) keeps its line so the tile doesn't jump.
          <p className="mt-0.5 text-xs" aria-hidden>
            &nbsp;
          </p>
        ) : null}
      </div>
      {Icon && <IconTile icon={Icon} tone={tone} />}
    </Comp>
  )
}

const CALLOUT_ICON: Partial<Record<Tone, LucideIcon>> = {
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
  info: Info,
  brand: Info,
  agent: Sparkles,
}

/**
 * An inline message box (also exported as `Alert`). Soft fill + AA text,
 * with an icon so colour is not the only signal. It is static by default;
 * pass role="alert" or role="status" when it appears in response to an action.
 */
export function Callout({
  tone = "info",
  title,
  icon,
  action,
  className,
  children,
  ...props
}: Omit<React.HTMLAttributes<HTMLDivElement>, "title"> & {
  tone?: Tone
  title?: React.ReactNode
  /** Override the default icon for the tone, or pass null for none. */
  icon?: LucideIcon | null
  action?: React.ReactNode
}) {
  const Icon = icon === null ? null : (icon ?? CALLOUT_ICON[tone] ?? Info)
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl border border-transparent px-4 py-3 text-sm",
        TONE_SOFT[tone],
        tone === "neutral" && "border-border text-foreground",
        className
      )}
      {...props}
    >
      {Icon && <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />}
      <div className="min-w-0 flex-1 leading-relaxed">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(title && "mt-0.5")}>{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  )
}

export { Callout as Alert }

export function Separator({ className, vertical }: { className?: string; vertical?: boolean }) {
  return (
    <div
      role="separator"
      aria-orientation={vertical ? "vertical" : "horizontal"}
      className={cn(vertical ? "h-full w-px" : "h-px w-full", "shrink-0 bg-border", className)}
    />
  )
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  className,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  eyebrow?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        {eyebrow && <div className="mb-1.5 min-h-4 text-xs font-medium text-muted-foreground">{eyebrow}</div>}
        <h1 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
