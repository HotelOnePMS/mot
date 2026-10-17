import { cn } from '@/lib/utils';
import { PRODUCT_NAME } from '@/config/product';

/**
 * Keyhole geometry on a 32×32 grid. The keyhole is an "O" over a "1" —
 * One — and the brass bar beneath it is the room's threshold.
 * Shared with the favicon (app/icon.svg), apple-icon and OG image.
 */
export const LOGO_GEOMETRY = {
  viewBox: '0 0 32 32',
  tileRadius: 9,
  bow: { cx: 16, cy: 11.5, r: 5 },
  stem: 'M14.15 14.2 12.7 20.7Q12.5 21.8 13.7 21.8H18.3Q19.5 21.8 19.3 20.7L17.85 14.2Z',
  threshold: 'M10.5 25.6h11',
} as const;

/**
 * The HotelOne mark: a Lagoon tile, an ivory keyhole and a brass threshold.
 * Colours come from the theme tokens, so it adapts to light and dark mode.
 * No SVG ids are used, so any number of marks can share a page.
 */
export function LogoMark({ className, title }: { className?: string; /** Accessible name; omit when the mark is decorative. */ title?: string }) {
  const g = LOGO_GEOMETRY;
  return (
    <svg
      viewBox={g.viewBox}
      className={cn('h-8 w-8 shrink-0', className)}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <rect width="32" height="32" rx={g.tileRadius} className="fill-primary" />
      <circle cx={g.bow.cx} cy={g.bow.cy} r={g.bow.r} className="fill-primary-foreground" />
      <path d={g.stem} className="fill-primary-foreground" />
      <path d={g.threshold} className="stroke-highlight" strokeWidth="2" strokeLinecap="round" fill="none" />
    </svg>
  );
}

/** "HotelOne" → ["Hotel", "One"]: the last capitalised word gets the weight. */
function splitName(name: string): [string, string] {
  const m = /^(.+?)([A-Z][^A-Z]*)$/.exec(name);
  return m ? [m[1], m[2]] : [name, ''];
}

export function Wordmark({ className }: { className?: string }) {
  const [lead, tail] = splitName(PRODUCT_NAME);
  return (
    <span className={cn('font-display text-xl leading-none tracking-tight', className)}>
      <span className="font-normal">{lead}</span>
      <span className="font-semibold">{tail}</span>
    </span>
  );
}

/**
 * Mark + wordmark. `compact` shows the mark only (with the name kept for
 * screen readers). Text colour is inherited, so it reads on light, dark and
 * inverse backgrounds alike.
 */
export function Logo({
  className,
  compact,
  markClassName,
  wordmarkClassName,
}: {
  className?: string;
  compact?: boolean;
  markClassName?: string;
  wordmarkClassName?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark className={markClassName} />
      {compact ? <span className="sr-only">{PRODUCT_NAME}</span> : <Wordmark className={wordmarkClassName} />}
    </span>
  );
}
