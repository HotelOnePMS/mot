"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import { inputBase } from "@/components/ui/input"
import { useFieldControl } from "@/components/ui/field-context"

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    const a11y = useFieldControl(props)
    return (
      <textarea
        className={cn(inputBase, "min-h-[88px] py-2.5 leading-relaxed", className)}
        ref={ref}
        {...props}
        {...a11y}
      />
    )
  }
)
Textarea.displayName = "Textarea"

export { Textarea }
