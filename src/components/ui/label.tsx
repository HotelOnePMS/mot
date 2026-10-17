"use client"

import * as React from "react"
import * as LabelPrimitive from "@radix-ui/react-label"
import { AlertCircle } from "lucide-react"

import { cn } from "@/lib/utils"
import { FieldContext } from "@/components/ui/field-context"

const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(
      "text-sm font-medium leading-5 text-foreground peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
      className
    )}
    {...props}
  />
))
Label.displayName = LabelPrimitive.Root.displayName

/**
 * Label + control + hint/error, with consistent spacing.
 *
 * The label, hint and error are wired to the control automatically: Input,
 * Textarea, SelectTrigger and Switch inside a Field pick up its id,
 * `aria-describedby` and `aria-invalid`. Pass `htmlFor` when the control
 * already has an id; otherwise one is generated.
 */
function Field({
  label,
  htmlFor,
  hint,
  description,
  error,
  required,
  optional,
  labelClassName,
  className,
  children,
}: {
  label: React.ReactNode
  htmlFor?: string
  hint?: React.ReactNode
  /** Alias of `hint`. */
  description?: React.ReactNode
  error?: React.ReactNode
  /** Marks the label as required (visual only; set `required` on the control too). */
  required?: boolean
  /** Adds a quiet "(optional)" after the label. */
  optional?: boolean
  labelClassName?: string
  className?: string
  children: React.ReactNode
}) {
  const autoId = React.useId()
  // A direct child with its own id is the control, even without htmlFor.
  const childId =
    React.isValidElement<{ id?: unknown }>(children) && typeof children.props.id === "string"
      ? children.props.id
      : undefined
  const controlId = htmlFor ?? childId ?? `field-${autoId}`
  const help = hint ?? description
  // The error replaces the hint, so only one of them is ever described.
  const errorId = error ? `${controlId}-error` : undefined
  const hintId = help && !error ? `${controlId}-hint` : undefined

  const claimed = React.useRef<string | null>(null)
  const claim = React.useCallback((token: string) => {
    if (claimed.current === null) claimed.current = token
    return claimed.current === token
  }, [])
  const release = React.useCallback((token: string) => {
    if (claimed.current === token) claimed.current = null
  }, [])

  const ctx = React.useMemo(
    () => ({
      controlId,
      describedBy: [errorId, hintId].filter(Boolean).join(" ") || undefined,
      invalid: Boolean(error),
      claim,
      release,
    }),
    [controlId, errorId, hintId, error, claim, release]
  )

  return (
    <div className={cn("grid content-start gap-2", className)}>
      <Label htmlFor={controlId} className={labelClassName}>
        {label}
        {required && (
          <span className="ml-0.5 text-destructive" aria-hidden>
            *
          </span>
        )}
        {optional && <span className="ml-1 font-normal text-muted-foreground">(optional)</span>}
      </Label>
      <FieldContext.Provider value={ctx}>{children}</FieldContext.Provider>
      {error ? (
        <p id={errorId} className="flex items-start gap-1.5 text-xs font-medium leading-5 text-destructive" role="alert">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>{error}</span>
        </p>
      ) : null}
      {hintId ? (
        <p id={hintId} className="text-xs leading-5 text-muted-foreground">
          {help}
        </p>
      ) : null}
    </div>
  )
}

export { Label, Field }
