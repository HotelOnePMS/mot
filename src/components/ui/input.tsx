"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import { useFieldControl } from "@/components/ui/field-context"

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>

/**
 * Shared look for text controls (Input, Textarea, SelectTrigger).
 * - border-input is the 3:1 control boundary; placeholder text meets 4.5:1.
 * - 16px text on phones (stops iOS zooming on focus), 14px from md up.
 * - aria-invalid="true" turns the boundary and focus halo destructive.
 */
export const inputBase =
  "flex w-full min-w-0 rounded-lg border border-input bg-surface px-3 text-base text-foreground shadow-xs transition-[border-color,box-shadow] placeholder:text-muted-foreground hover:border-foreground/60 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60 aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:ring-destructive/20 md:text-sm"

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    const a11y = useFieldControl(props)
    return (
      <input
        type={type}
        className={cn(
          inputBase,
          "h-10 py-2 file:mr-3 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
          className
        )}
        ref={ref}
        {...props}
        {...a11y}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
