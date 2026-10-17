'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

/**
 * The one save pattern for console forms: a bar that slides up and sticks
 * to the bottom of the window while there are unsaved changes, and is gone
 * (not just moved off-screen) when there aren't. Place it as the last child
 * of the form's column so it sticks within that column.
 */
export function SaveBar({
  dirty,
  saving,
  onSave,
  onDiscard,
  message = 'You have unsaved changes',
  saveLabel = 'Save changes',
  disabled,
  className,
}: {
  dirty: boolean;
  saving?: boolean;
  onSave: () => void;
  onDiscard?: () => void;
  message?: React.ReactNode;
  saveLabel?: string;
  /** Keep Save disabled (e.g. while a field is invalid). */
  disabled?: boolean;
  className?: string;
}) {
  return (
    <>
      <span role="status" aria-live="polite" className="sr-only">
        {dirty ? 'You have unsaved changes.' : ''}
      </span>
      {dirty && (
        <div className={cn('sticky bottom-0 z-20 -mx-4 animate-fade-up sm:mx-0 sm:pb-4', className)}>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t bg-surface/95 px-4 py-3 shadow-float backdrop-blur sm:rounded-2xl sm:border sm:px-5">
            <p className="text-sm font-medium">{message}</p>
            <div className="ml-auto flex gap-2">
              {onDiscard && (
                <Button type="button" variant="ghost" onClick={onDiscard} disabled={saving}>
                  Discard
                </Button>
              )}
              <Button type="button" onClick={onSave} loading={saving} loadingText="Saving…" disabled={disabled}>
                {saveLabel}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
