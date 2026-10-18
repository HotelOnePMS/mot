// The voice settings page's "How it sounds" card (src/app/admin/voice/page.tsx
// Settings()), rebuilt at the narrow layout: Field (label + control + hint,
// from ui/label.tsx), Textarea/Input (ui/input.tsx inputBase: border-input,
// bg-surface, 16px text on phones, leading-relaxed) and the House rules field.
import React from 'react';
import {Icon} from './icons.tsx';
import {Card} from './primitives.tsx';
import {alpha, RADIUS, shadow, useHO, type Mode} from './tokens.ts';

/** The House rules Gus typed. Lines 1-2 match the seed wording (prisma/seed.js L373); line 3 is the quiet-hours rule. */
export const HOUSE_RULES = ['We don’t offer day-use rooms.', 'Dogs under 30 lb are welcome for $25 a night.', 'Quiet hours start at 10 PM.'] as const;
export const HOUSE_RULES_HINT = 'Anything the voice should always do or never say. It still can’t invent prices or availability.';
/** Gus's greeting: it contains "AI", so phoneGreeting() plays it verbatim. */
export const STARLITE_GREETING = 'Starlite Motor Court, AI front desk. How can I help?';

// ─── Field / controls ───────────────────────────────────────────────────────

export type FieldProps = {
  label: React.ReactNode;
  optional?: boolean;
  hint?: React.ReactNode;
  /** Hint opacity and blur (S14: the hint sits at 20%, defocused). */
  hintOpacity?: number;
  hintBlur?: number;
  labelStyle?: React.CSSProperties;
  mode?: Mode;
  children: React.ReactNode;
};

/** ui/label.tsx Field: `grid content-start gap-2`; Label text-sm 500 leading-5; then the control; then the hint (text-xs leading-5 muted). */
export const Field: React.FC<FieldProps> = ({label, optional, hint, hintOpacity = 1, hintBlur = 0, labelStyle, mode, children}) => {
  const t = useHO(mode);
  return (
    <div style={{display: 'grid', alignContent: 'start', gap: 8}}>
      <label style={{fontSize: 14, fontWeight: 500, lineHeight: '20px', color: t.foreground, ...labelStyle}}>
        {label}
        {optional ? <span style={{marginLeft: 4, fontWeight: 400, color: t.mutedForeground}}>(optional)</span> : null}
      </label>
      {children}
      {hint ? (
        <p style={{margin: 0, fontSize: 12, lineHeight: '20px', color: t.mutedForeground, opacity: hintOpacity, filter: hintBlur ? `blur(${hintBlur}px)` : undefined}}>{hint}</p>
      ) : null}
    </div>
  );
};

export type ControlTone = 'app' | 'sunken';

/** inputBase: rounded-lg border border-input bg-surface px-3 text-base (16px below md) shadow-xs. `sunken` swaps the fill for surface-sunken (the board's S14 variant). */
const controlStyle = (t: ReturnType<typeof useHO>, tone: ControlTone, borderAlpha = 1): React.CSSProperties => ({
  display: 'flex',
  width: '100%',
  minWidth: 0,
  borderRadius: RADIUS.lg,
  border: `1px solid ${borderAlpha >= 1 ? t.borderStrong : alpha(t.borderStrong, borderAlpha)}`,
  background: tone === 'sunken' ? t.surfaceSunken : t.surface,
  padding: '0 12px',
  fontSize: 16,
  color: t.foreground,
  boxShadow: shadow(t, 'xs'),
  boxSizing: 'border-box',
});

export const Input: React.FC<{value?: string; placeholder?: string; tone?: ControlTone; mode?: Mode}> = ({value, placeholder, tone = 'app', mode}) => {
  const t = useHO(mode);
  return (
    <div style={{...controlStyle(t, tone), height: 40, alignItems: 'center', lineHeight: '24px', whiteSpace: 'nowrap', overflow: 'hidden'}}>
      {value ? <span>{value}</span> : <span style={{color: t.mutedForeground}}>{placeholder}</span>}
    </div>
  );
};

export type TextLine = {
  text: string;
  /** Line opacity (S14: the two other rules at 0.4). */
  opacity?: number;
  /** 0..1 highlight sweep left to right (S14: primary-soft fill, primary-soft-foreground text). */
  highlight?: number;
};

export type TextareaProps = {
  lines: Array<string | TextLine>;
  /** Visible rows (the textarea's `rows`); the box is rows x 26px + py-2.5 tall unless the text needs more. */
  rows?: number;
  minHeight?: number;
  tone?: ControlTone;
  borderAlpha?: number;
  mode?: Mode;
};

/** ui/textarea.tsx: inputBase + min-h-[88px] py-2.5 leading-relaxed, pre-wrapped text. */
export const Textarea: React.FC<TextareaProps> = ({lines, rows = 4, minHeight = 88, tone = 'app', borderAlpha, mode}) => {
  const t = useHO(mode);
  const lh = 26; // 16px x leading-relaxed (1.625)
  return (
    <div
      style={{
        ...controlStyle(t, tone, borderAlpha),
        display: 'block',
        padding: '10px 12px',
        lineHeight: `${lh}px`,
        minHeight: Math.max(minHeight, rows * lh + 22),
        whiteSpace: 'pre-wrap',
        overflowWrap: 'break-word',
      }}
    >
      {lines.map((l, i) => {
        const line: TextLine = typeof l === 'string' ? {text: l} : l;
        const h = Math.max(0, Math.min(1, line.highlight ?? 0));
        return (
          <div key={i} style={{opacity: line.opacity ?? 1}}>
            <span style={{position: 'relative', display: 'inline-block', maxWidth: '100%'}}>
              {line.text}
              {h > 0 ? (
                <span
                  aria-hidden
                  style={{
                    position: 'absolute',
                    inset: '0 -4px',
                    padding: '0 4px',
                    borderRadius: 6,
                    background: t.primarySoft,
                    color: t.primarySoftForeground,
                    clipPath: `inset(0 ${(1 - h) * 100}% 0 0)`,
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {line.text}
                </span>
              ) : null}
            </span>
          </div>
        );
      })}
    </div>
  );
};

// ─── House rules ────────────────────────────────────────────────────────────

export type HouseRulesFieldProps = {
  /** Per-line state, in HOUSE_RULES order. Strings or {text, opacity, highlight}. Default HOUSE_RULES at full opacity. */
  lines?: Array<string | TextLine>;
  hintOpacity?: number;
  hintBlur?: number;
  /** 'app' = bg-surface like the real field (default); 'sunken' = the board's #090b11 fill. */
  tone?: ControlTone;
  /** Border alpha (the board asks for border-input at 50%; the app uses 100%). */
  borderAlpha?: number;
  mode?: Mode;
};

/** `<Field label="House rules" hint="Anything the voice…">` + `<Textarea rows={4}>`, as on the voice settings page. */
export const HouseRulesField: React.FC<HouseRulesFieldProps> = ({lines = [...HOUSE_RULES], hintOpacity, hintBlur, tone, borderAlpha, mode}) => (
  <Field label="House rules" hint={HOUSE_RULES_HINT} hintOpacity={hintOpacity} hintBlur={hintBlur} mode={mode}>
    <Textarea lines={lines} rows={4} tone={tone} borderAlpha={borderAlpha} mode={mode} />
  </Field>
);

export type HowItSoundsCardProps = HouseRulesFieldProps & {
  greeting?: string;
  /** Fade the card in from transparent at its top edge to opaque at this many CSS px (S14: the fields above House rules fade out of the crop). */
  fadeTo?: number;
  /** Where the fade starts (CSS px from the card top). */
  fadeFrom?: number;
  shadowKind?: 'xs' | 'soft' | 'lifted' | 'float';
  style?: React.CSSProperties;
};

/**
 * The whole "How it sounds" card at the narrow layout (`Card space-y-5 p-5`, one column):
 * Voice (ElevenLabs: "Chosen for you by HotelOne"), Hand-off phone number (optional), Greeting, House rules.
 */
export const HowItSoundsCard: React.FC<HowItSoundsCardProps> = ({greeting = STARLITE_GREETING, fadeTo, fadeFrom = 0, shadowKind, style, mode, ...rules}) => {
  const t = useHO(mode);
  const mask = fadeTo !== undefined ? `linear-gradient(to bottom, transparent ${fadeFrom}px, #000 ${fadeTo}px)` : undefined;
  return (
    <Card mode={mode} shadowKind={shadowKind} style={{padding: 20, display: 'flex', flexDirection: 'column', gap: 20, maskImage: mask, WebkitMaskImage: mask, ...style}}>
      <h2 style={{margin: 0, fontSize: 16, lineHeight: '24px', fontWeight: 600, letterSpacing: '-0.025em'}}>How it sounds</h2>
      <div style={{display: 'grid', gap: 20}}>
        <div style={{display: 'grid', alignContent: 'start', gap: 8}}>
          <p style={{margin: 0, fontSize: 14, fontWeight: 500, lineHeight: '20px'}}>Voice</p>
          <p
            style={{
              margin: 0,
              display: 'flex',
              minHeight: 40,
              alignItems: 'center',
              gap: 8,
              borderRadius: RADIUS.lg,
              border: `1px solid ${t.border}`,
              background: t.surfaceSunken,
              padding: '0 12px',
              fontSize: 14,
              lineHeight: '20px',
              color: t.mutedForeground,
              boxSizing: 'border-box',
            }}
          >
            <Icon name="audio-lines" size={16} /> Chosen for you by HotelOne
          </p>
        </div>
        <Field label="Hand-off phone number" optional hint="Given out when a caller wants a person. Include the country code, like +1 831 555 0100." mode={mode}>
          <Input placeholder="+1 831 555 0100" tone={rules.tone} mode={mode} />
        </Field>
      </div>
      <Field label="Greeting" hint="The first thing callers hear." mode={mode}>
        <Textarea lines={[greeting]} rows={1} minHeight={40} tone={rules.tone} mode={mode} />
      </Field>
      <HouseRulesField {...rules} mode={mode} />
    </Card>
  );
};
