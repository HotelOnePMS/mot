// One rate-calendar cell (src/app/admin/rate-calendar/page.tsx L399-465) in
// its sm-and-up rendering: h-[88px] rounded-lg border p-2; day number
// (text-2xs), whole() price (text-[15px] 600 tabular on text-xs's 16px line, mt-auto), a 1.5 tall
// occupancy bar (bg-primary/70, bg-success from 85%), "{sold}/{total} sold"
// (text-2xs muted). The custom-price dot only appears when isCustom.
import React from 'react';
import {alpha, mix, RADIUS, TRACK_2XS, uiFont, useHO, type Mode} from './tokens.ts';

export type RateCellProps = {
  day: number;
  /** Nightly price in USD (whole() drops the cents: "$119"). */
  price: number;
  sold: number;
  total: number;
  isCustom?: boolean;
  /** Fri/Sat nights get `bg-muted/70` (composited over the calendar card so the cell stays opaque); other nights bg-card. */
  weekend?: boolean;
  isToday?: boolean;
  /** Cell width in CSS px (a 7-column grid with gap-1; default 92). */
  width?: number;
  mode?: Mode;
  style?: React.CSSProperties;
};

const whole = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

/** Story data: Queen Room, Friday the 23rd, $119, 7/12 sold, no custom price. */
export const QUEEN_FRI = {day: 23, price: 119, sold: 7, total: 12, isCustom: false, weekend: true} as const;

export const RateCell: React.FC<RateCellProps> = ({day, price, sold, total, isCustom = false, weekend = false, isToday = false, width = 92, mode, style}) => {
  const t = useHO(mode);
  const occ = total ? sold / total : 0;
  const bg = weekend ? mix(t.card, t.muted, 0.7) : t.card;
  return (
    <div
      style={{
        ...uiFont,
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        width,
        height: 88,
        minWidth: 0,
        borderRadius: RADIUS.lg,
        border: `1px solid ${isToday ? alpha(t.primary, 0.6) : t.border}`,
        boxShadow: isToday ? `inset 0 0 0 1px ${alpha(t.primary, 0.3)}` : undefined,
        background: bg,
        padding: 8,
        textAlign: 'left',
        boxSizing: 'border-box',
        lineHeight: 1.5,
        ...style,
      }}
    >
      <span style={{fontSize: 11, lineHeight: '16px', letterSpacing: TRACK_2XS, fontVariantNumeric: 'tabular-nums', fontWeight: isToday ? 700 : 500, color: isToday ? t.primarySoftForeground : t.foreground}}>{day}</span>
      {/* text-xs sm:text-[15px]: the sm size only swaps the font-size, so the line box keeps text-xs's 16px */}
      <span style={{marginTop: 'auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600, fontVariantNumeric: 'tabular-nums', fontSize: 15, lineHeight: '16px', color: isCustom ? t.primarySoftForeground : t.foreground}}>
        {whole(price)}
      </span>
      <span style={{marginTop: 4, height: 6, width: '100%', overflow: 'hidden', borderRadius: RADIUS.full, background: t.muted, display: 'block'}}>
        <span style={{display: 'block', height: '100%', borderRadius: RADIUS.full, background: occ >= 0.85 ? t.success : alpha(t.primary, 0.7), width: `${Math.max(occ > 0 ? 8 : 0, occ * 100)}%`}} />
      </span>
      <span style={{marginTop: 2, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11, lineHeight: '16px', letterSpacing: TRACK_2XS, color: t.mutedForeground, fontVariantNumeric: 'tabular-nums'}}>
        {sold}/{total} sold
      </span>
      {isCustom ? <span style={{position: 'absolute', right: 8, top: 10, width: 8, height: 8, borderRadius: RADIUS.full, background: t.primary}} /> : null}
    </div>
  );
};
