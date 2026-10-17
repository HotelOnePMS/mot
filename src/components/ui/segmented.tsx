"use client"

import * as React from "react"
import { motion, useReducedMotion } from "framer-motion"

import { cn } from "@/lib/utils"

export interface SegmentedOption<T extends string> {
  value: T
  label: React.ReactNode
  icon?: React.ReactNode
  /** Extra classes for the moving pill when this option is active. */
  activeClassName?: string
  disabled?: boolean
}

/**
 * Accessible segmented control (radiogroup) with an animated selection pill.
 * Arrow keys move the selection (Home/End jump to the ends), matching native
 * radio behaviour. Options never wrap; a long row scrolls sideways on phones.
 */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  size = "md",
  className,
  layoutId,
  "aria-label": ariaLabel,
}: {
  value: T
  onChange: (v: T) => void
  options: SegmentedOption<T>[]
  size?: "sm" | "md"
  className?: string
  layoutId: string
  "aria-label": string
}) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([])
  const reduceMotion = useReducedMotion()
  const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0)
  // If the value matches no option, keep the first enabled option tabbable.
  const activeIndex = options.findIndex((o) => o.value === value)
  const tabbable = activeIndex >= 0 && !options[activeIndex].disabled ? activeIndex : enabled[0]

  // When the row is wider than its box (phones), fade the edge(s) that hide
  // more options and keep the selected option scrolled into view.
  const trackRef = React.useRef<HTMLDivElement>(null)
  const [edges, setEdges] = React.useState({ start: false, end: false })
  React.useEffect(() => {
    const el = trackRef.current
    if (!el) return
    const update = () => {
      const max = el.scrollWidth - el.clientWidth
      const next = { start: el.scrollLeft > 1, end: el.scrollLeft < max - 1 }
      setEdges((prev) => (prev.start === next.start && prev.end === next.end ? prev : next))
    }
    update()
    el.addEventListener("scroll", update, { passive: true })
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null
    ro?.observe(el)
    return () => {
      el.removeEventListener("scroll", update)
      ro?.disconnect()
    }
  }, [options.length])
  React.useEffect(() => {
    const el = trackRef.current
    const btn = activeIndex >= 0 ? refs.current[activeIndex] : null
    if (!el || !btn || el.scrollWidth <= el.clientWidth) return
    const left = btn.offsetLeft - 24
    const right = btn.offsetLeft + btn.offsetWidth + 24 - el.clientWidth
    if (el.scrollLeft > left) el.scrollLeft = Math.max(0, left)
    else if (el.scrollLeft < right) el.scrollLeft = right
  }, [activeIndex])
  const fade = 28
  const mask =
    edges.start || edges.end
      ? `linear-gradient(to right, ${edges.start ? `transparent, #000 ${fade}px` : "#000"}, ${edges.end ? `#000 calc(100% - ${fade}px), transparent` : "#000"})`
      : undefined

  function move(to: number) {
    const opt = options[to]
    if (!opt) return
    onChange(opt.value)
    refs.current[to]?.focus()
  }

  function onKeyDown(e: React.KeyboardEvent, index: number) {
    if (enabled.length === 0) return
    const pos = Math.max(0, enabled.indexOf(index))
    let next: number | undefined
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = enabled[(pos + 1) % enabled.length]
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = enabled[(pos - 1 + enabled.length) % enabled.length]
    else if (e.key === "Home") next = enabled[0]
    else if (e.key === "End") next = enabled[enabled.length - 1]
    if (next === undefined) return
    e.preventDefault()
    move(next)
  }

  return (
    <div
      ref={trackRef}
      role="radiogroup"
      aria-label={ariaLabel}
      style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
      className={cn(
        "relative inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-xl bg-muted p-1 ring-1 ring-inset ring-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className
      )}
    >
      {options.map((opt, i) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={opt.disabled}
            tabIndex={i === tabbable ? 0 : -1}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              // 32px pill in a 40px track; the ::after stretches the hit area over the track padding (40px).
              "relative z-10 inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-colors after:absolute after:-inset-y-1 after:inset-x-0 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-muted disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
              size === "sm" ? "h-8 px-2.5 text-xs" : "h-8 px-3 text-[13px]",
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                transition={reduceMotion ? { duration: 0 } : { type: "spring", bounce: 0.18, duration: 0.45 }}
                className={cn(
                  "absolute inset-0 -z-10 rounded-lg bg-surface shadow-xs ring-1 ring-border-strong/25",
                  opt.activeClassName
                )}
              />
            )}
            {opt.icon}
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
