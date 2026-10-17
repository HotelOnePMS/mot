'use client';

import * as React from 'react';
import { BedDouble, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * An <img> that fades in when loaded and falls back to a soft branded
 * placeholder when the URL is missing or fails (offline, blocked host,
 * deleted upload) — never a broken-image icon.
 *
 * The box never changes size: give it a height or aspect ratio through
 * `className` (e.g. "aspect-[4/3]") or the `aspectRatio` prop, and the image
 * is absolutely positioned inside it.
 */
export function SmartImage({
  src,
  alt = '',
  className,
  imgClassName,
  icon: Icon = BedDouble,
  loading = 'lazy',
  aspectRatio,
  sizes,
  priority,
}: {
  src?: string | null;
  alt?: string;
  className?: string;
  imgClassName?: string;
  icon?: LucideIcon;
  loading?: 'lazy' | 'eager';
  /** CSS aspect-ratio for the box, e.g. "4 / 3" or 1.5. */
  aspectRatio?: string | number;
  sizes?: string;
  /** Above-the-fold hero image: load eagerly with high fetch priority. */
  priority?: boolean;
}) {
  const [state, setState] = React.useState<'loading' | 'ok' | 'error'>(src ? 'loading' : 'error');
  const ref = React.useRef<HTMLImageElement>(null);
  React.useEffect(() => {
    setState(src ? 'loading' : 'error');
  }, [src]);
  // Cached images can finish before hydration attaches onLoad.
  React.useEffect(() => {
    const img = ref.current;
    if (img?.complete) setState(img.naturalWidth > 0 ? 'ok' : 'error');
  }, [src]);

  return (
    <div
      className={cn('relative overflow-hidden bg-muted', className)}
      style={aspectRatio !== undefined ? { aspectRatio: String(aspectRatio) } : undefined}
      // Keep the description available when the photo itself fails.
      {...(state === 'error' && alt ? { role: 'img', 'aria-label': alt } : {})}
    >
      {state !== 'ok' && (
        <div
          aria-hidden
          className={cn(
            'absolute inset-0 flex items-center justify-center bg-gradient-to-br from-brand-soft via-muted to-surface-sunken',
            state === 'loading' && 'animate-pulse'
          )}
        >
          {state === 'error' && <Icon className="size-1/4 max-h-12 max-w-12 text-muted-foreground/60" aria-hidden />}
        </div>
      )}
      {src && state !== 'error' && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={ref}
          src={src}
          alt={alt}
          sizes={sizes}
          loading={priority ? 'eager' : loading}
          fetchPriority={priority ? 'high' : undefined}
          decoding="async"
          onLoad={() => setState('ok')}
          onError={() => setState('error')}
          className={cn(
            'absolute inset-0 h-full w-full object-cover transition-opacity duration-500',
            state === 'ok' ? 'opacity-100' : 'opacity-0',
            imgClassName
          )}
        />
      )}
    </div>
  );
}
