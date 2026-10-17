"use client"

import * as React from "react"

/**
 * Lets <Field> wire its label, hint and error to the control inside it
 * without the caller passing ids around. Input, Textarea, SelectTrigger and
 * Switch read it. Only the first control that renders claims the field's id,
 * so a field that wraps several controls never produces duplicate ids.
 */
type FieldContextValue = {
  controlId: string
  describedBy?: string
  invalid: boolean
  claim: (token: string) => boolean
  release: (token: string) => void
}

export const FieldContext = React.createContext<FieldContextValue | null>(null)

type ControlA11yProps = {
  id?: string
  "aria-describedby"?: string
  "aria-invalid"?: React.AriaAttributes["aria-invalid"]
}

function joinIds(...ids: (string | undefined)[]) {
  const out = ids.filter(Boolean).join(" ")
  return out || undefined
}

/** Merge a control's own a11y props with the ones from an enclosing <Field>. */
export function useFieldControl<P extends ControlA11yProps>(props: P): ControlA11yProps {
  const ctx = React.useContext(FieldContext)
  const token = React.useId()
  const release = ctx?.release
  React.useEffect(() => () => release?.(token), [release, token])

  if (!ctx) {
    return { id: props.id, "aria-describedby": props["aria-describedby"], "aria-invalid": props["aria-invalid"] }
  }
  const owns = props.id ? props.id === ctx.controlId : ctx.claim(token)
  return {
    id: props.id ?? (owns ? ctx.controlId : undefined),
    "aria-describedby": owns ? joinIds(props["aria-describedby"], ctx.describedBy) : props["aria-describedby"],
    "aria-invalid": props["aria-invalid"] ?? (owns && ctx.invalid ? true : undefined),
  }
}
