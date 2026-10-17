import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import type { LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Status and label pills. Tones use a soft fill with its matching
 * *-soft-foreground text (AA in both themes). Pair a tone with `dot` or
 * `icon` so colour is never the only signal.
 * - success / warning / danger / info: status only.
 * - highlight (brass): sparing premium marks ("Best value", "Popular").
 * - agent (violet): AI features only.
 */
const badgeVariants = cva(
  "inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium leading-5 transition-colors [&_svg]:size-3.5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive: "border-transparent bg-destructive text-destructive-foreground",
        outline: "border-border bg-transparent text-foreground",
        neutral: "border-transparent bg-muted text-muted-foreground",
        brand: "border-transparent bg-primary-soft text-primary-soft-foreground",
        primary: "border-transparent bg-primary-soft text-primary-soft-foreground",
        highlight: "border-transparent bg-highlight-soft text-highlight-soft-foreground",
        success: "border-transparent bg-success-soft text-success-soft-foreground",
        warning: "border-transparent bg-warning-soft text-warning-soft-foreground",
        danger: "border-transparent bg-destructive-soft text-destructive-soft-foreground",
        info: "border-transparent bg-info-soft text-info-soft-foreground",
        agent: "border-transparent bg-agent-soft text-agent-soft-foreground",
      },
      size: {
        default: "",
        sm: "gap-1 px-2 py-0 text-2xs leading-[18px] [&_svg]:size-3",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  dot?: boolean
  /** Leading icon (decorative; the text carries the meaning). */
  icon?: LucideIcon
}

function Badge({ className, variant, size, dot, icon: Icon, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant, size }), className)} {...props}>
      {dot && !Icon && <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden />}
      {Icon && <Icon aria-hidden />}
      {children}
    </span>
  )
}

export { Badge, badgeVariants }
