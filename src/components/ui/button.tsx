import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"

/** Invisible hit area so compact buttons still get a ~44px touch target. */
const HIT_AREA = "after:absolute after:-inset-1 after:content-['']"

const buttonVariants = cva(
  "relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-[background-color,background-position,border-color,color,box-shadow,transform,opacity] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 aria-busy:cursor-progress aria-busy:disabled:opacity-75 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        /** The one main action in a region. */
        default: "bg-primary text-primary-foreground shadow-xs hover:bg-primary-hover",
        /** The hotel's own colour on guest pages (falls back to primary). */
        brand: "bg-brand text-brand-foreground shadow-xs hover:brightness-[0.92] dark:hover:brightness-110",
        /** AI features only: the agent, the voice agent, "Ask the agent". */
        agent:
          "bg-aurora bg-[position:0%_50%] text-agent-gradient-foreground shadow-glow hover:bg-[position:100%_50%]",
        destructive: "bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90",
        outline:
          "border border-border-strong/50 bg-surface text-foreground shadow-xs hover:border-border-strong hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-accent hover:text-accent-foreground",
        soft: "bg-primary-soft text-primary-soft-foreground hover:bg-primary/15",
        ghost: "text-foreground hover:bg-accent hover:text-accent-foreground",
        /** Inline text link styled as a button; ignores the size padding/height. */
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4",
        sm: cn("h-9 rounded-md px-3 text-[13px]", HIT_AREA),
        lg: "h-12 rounded-xl px-6 text-base",
        xl: "h-14 rounded-xl px-8 text-base",
        icon: "size-10",
        "icon-sm": cn("size-9 rounded-md", HIT_AREA),
        "icon-lg": "size-11 rounded-xl [&_svg]:size-5",
      },
    },
    compoundVariants: [
      {
        variant: "link",
        class:
          "h-auto rounded-sm p-0 shadow-none after:hidden active:scale-100 [&_svg]:size-[1em]",
      },
    ],
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  /** Shows a spinner (in place of the button's own icon), sets aria-busy and disables it. */
  loading?: boolean
  /** Optional text announced to screen readers while loading, e.g. "Saving…". */
  loadingText?: string
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, loadingText, disabled, children, ...props }, ref) => {
    if (asChild) {
      return (
        <Slot
          className={cn(buttonVariants({ variant, size, className }))}
          ref={ref}
          aria-busy={loading || undefined}
          {...props}
        >
          {children}
        </Slot>
      )
    }
    return (
      <button
        className={cn(
          buttonVariants({ variant, size, className }),
          loading && "[&>svg:not([data-spinner])]:hidden"
        )}
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading && <Loader2 data-spinner className="animate-spin" aria-hidden />}
        {children}
        {loading && loadingText && <span className="sr-only">{loadingText}</span>}
      </button>
    )
  }
)
Button.displayName = "Button"

export interface IconButtonProps extends Omit<ButtonProps, "aria-label"> {
  /** Required accessible name for an icon-only button (also shown as a tooltip). */
  label: string
}

/** An icon-only Button that cannot be rendered without an accessible name. */
const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ label, size = "icon", variant = "ghost", title, ...props }, ref) => (
    <Button ref={ref} size={size} variant={variant} aria-label={label} title={title ?? label} {...props} />
  )
)
IconButton.displayName = "IconButton"

export { Button, IconButton, buttonVariants }
