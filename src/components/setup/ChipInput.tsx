'use client';

import * as React from 'react';
import { Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFieldControl } from '@/components/ui/field-context';

/**
 * Tag-style input: type and press Enter (or comma) to add; click a
 * suggestion to add it; Backspace on empty removes the last chip.
 *
 * Inside a <Field> the text box picks up the field's label, hint and error.
 * Every chip has a labelled remove button, and additions/removals are
 * announced to screen readers.
 */
export function ChipInput({
  value,
  onChange,
  suggestions = [],
  placeholder,
  id,
  max = 40,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
  className,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  suggestions?: string[];
  placeholder?: string;
  id?: string;
  max?: number;
  /** Accessible name when the input isn't inside a <Field>. */
  'aria-label'?: string;
  'aria-describedby'?: string;
  className?: string;
}) {
  const [text, setText] = React.useState('');
  const [announcement, setAnnouncement] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement>(null);
  const a11y = useFieldControl({ id, 'aria-describedby': ariaDescribedBy });
  const has = (s: string) => value.some((v) => v.toLowerCase() === s.toLowerCase());
  const full = value.length >= max;
  const add = (raw: string) => {
    const s = raw.trim().replace(/,$/, '');
    if (!s || has(s) || full) return;
    onChange([...value, s]);
    setAnnouncement(`Added ${s}`);
  };
  const remove = (v: string, refocus = true) => {
    onChange(value.filter((x) => x !== v));
    setAnnouncement(`Removed ${v}`);
    if (refocus) inputRef.current?.focus();
  };
  const remaining = suggestions.filter((s) => !has(s));

  return (
    <div className={className}>
      <div
        className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border border-input bg-surface px-2 py-1.5 shadow-xs transition-[border-color,box-shadow] hover:border-foreground/60 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/25 has-[:disabled]:cursor-not-allowed has-[:disabled]:bg-muted has-[:disabled]:opacity-60"
        onClick={(e) => {
          if (e.target === e.currentTarget) inputRef.current?.focus();
        }}
      >
        {value.length > 0 && (
          <ul className="contents" aria-label="Added">
            {value.map((v) => (
              <li key={v} className="inline-flex items-center gap-0.5 rounded-md bg-primary-soft py-0.5 pl-2 pr-0.5 text-sm font-medium text-primary-soft-foreground">
                {v}
                <button
                  type="button"
                  onClick={() => remove(v)}
                  className="relative flex size-6 items-center justify-center rounded-sm transition-colors after:absolute after:-inset-1 after:content-[''] hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none"
                  aria-label={`Remove ${v}`}
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        <input
          ref={inputRef}
          {...a11y}
          aria-label={ariaLabel}
          value={text}
          onChange={(e) => {
            const v = e.target.value;
            if (v.endsWith(',')) {
              add(v);
              setText('');
            } else setText(v);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add(text);
              setText('');
            } else if (e.key === 'Backspace' && !text && value.length) {
              remove(value[value.length - 1], false);
            }
          }}
          onBlur={() => {
            if (text.trim()) {
              add(text);
              setText('');
            }
          }}
          placeholder={full ? `Up to ${max}` : value.length ? 'Add another' : placeholder}
          enterKeyHint="enter"
          autoComplete="off"
          className="h-7 min-w-[8rem] flex-1 bg-transparent px-1 text-base text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed md:text-sm"
        />
      </div>
      <span role="status" aria-live="polite" className="sr-only">
        {announcement}
      </span>
      {remaining.length > 0 && !full && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="Suggestions">
          <span className="mr-0.5 text-xs text-muted-foreground" aria-hidden>
            Suggestions:
          </span>
          {remaining.slice(0, 12).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => add(s)}
              aria-label={`Add ${s}`}
              className={cn(
                'relative inline-flex h-8 items-center gap-1 rounded-md border border-dashed border-border-strong/60 px-2 text-xs text-muted-foreground transition-colors after:absolute after:-inset-y-1 after:inset-x-0 after:content-[""] hover:border-primary/60 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none'
              )}
            >
              <Plus className="size-3" aria-hidden /> {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
