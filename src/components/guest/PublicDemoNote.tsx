import { TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Public demo: the staff logins are shared, so guests shouldn't enter real details. */
export function PublicDemoNote({ className }: { className?: string }) {
  if (process.env.NEXT_PUBLIC_DEMO_MODE !== 'true') return null;
  return (
    <p
      role="note"
      className={cn(
        'flex items-start gap-2.5 rounded-xl border border-warning/30 bg-warning-soft px-3.5 py-2.5 text-sm leading-relaxed text-warning-soft-foreground',
        className
      )}
    >
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>
        <span className="font-medium">This is a public demo.</span> Anyone with a staff demo login can see guest details, so please use a made-up name and
        email.
      </span>
    </p>
  );
}
