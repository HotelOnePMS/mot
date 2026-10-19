import { Badge, type BadgeProps } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export const CHANNEL_NAMES: Record<string, string> = {
  EXPEDIA: 'Expedia',
  BOOKING_COM: 'Booking.com',
};

/** The OTAs' own brand colours, so the two read apart at a glance (the name carries the meaning). */
const CHANNEL_COLORS: Record<string, string> = {
  EXPEDIA: 'border-[#FFC72C]/60 bg-[#FFC72C]/15 text-foreground',
  BOOKING_COM: 'border-[#003580]/40 bg-[#003580]/10 text-foreground dark:border-[#5c8ae6]/50 dark:bg-[#5c8ae6]/15',
};

export function ChannelBadge({ channel, className }: { channel: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold', CHANNEL_COLORS[channel], className)}>
      {CHANNEL_NAMES[channel] ?? channel}
    </span>
  );
}

const STATUS_VARIANT: Record<string, BadgeProps['variant']> = {
  DRAFT: 'neutral',
  CONNECTED: 'info',
  ACTIVE: 'success',
  PAUSED: 'warning',
  ERROR: 'danger',
  // promotions / reservations / logs
  INACTIVE: 'neutral',
  FAILED: 'danger',
  SUCCESS: 'success',
  BOOKED: 'success',
  MODIFIED: 'info',
  CANCELLED: 'danger',
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Setup started',
  CONNECTED: 'Verified - map rooms',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={STATUS_VARIANT[status] ?? 'neutral'} size="sm" dot>
      {STATUS_LABELS[status] ?? status.charAt(0) + status.slice(1).toLowerCase()}
    </Badge>
  );
}

export function ModeBadge({ mode }: { mode: string }) {
  return mode === 'LIVE' ? (
    <Badge variant="success" size="sm">
      Live
    </Badge>
  ) : (
    <Badge variant="outline" size="sm" className="border-dashed text-muted-foreground">
      Sandbox
    </Badge>
  );
}

export function timeAgo(value: string | Date | null | undefined): string {
  if (!value) return 'never';
  const seconds = Math.round((Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  return `${Math.floor(seconds / 86400)} d ago`;
}

/** Reads a JSON API response, throwing the server's error message on failure */
export async function apiJson<T = any>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data as T;
}
