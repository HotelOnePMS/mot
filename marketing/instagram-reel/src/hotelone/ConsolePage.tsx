// The staff console around the inbox, at the real narrow (below-sm) layout:
// ConsoleShell's phone header (src/components/console/ConsoleShell.tsx: glass
// h-14 bar with the menu button, PropertySwitcher and the account avatar),
// PageHeader (src/components/ui/primitives.tsx) and the voice page's Messages
// tab (src/app/admin/voice/page.tsx: FRAME, the section tabs, Requests()).
// S22 pushes from Gus's phone (the whole page, tiny) into this page at 3x.
import React from 'react';
import {Icon} from './icons.tsx';
import {MessagesList, type GuestRequest, type RowFx} from './Messages.tsx';
import {Avatar, SegmentedControl, type SegmentedProps} from './primitives.tsx';
import {alpha, mix, RADIUS, shadow, uiFont, useHO, type Mode} from './tokens.ts';

/** The story's property and user. */
export const STARLITE = 'Starlite Motor Court';

/** The phone header's height in CSS px: h-14 + the 1px border-b. */
export const HEADER_H = 57;

// ─── Console header (phones) ────────────────────────────────────────────────

export type ConsoleHeaderProps = {
  property?: string;
  /** The signed-in staff member (Avatar initials and tone come from the name). */
  user?: string;
  /**
   * Content scrolls beneath the pinned header. The app's .glass is surface/72% + backdrop saturate(180%) blur(14px);
   * the renderer's headless Chrome does not paint backdrop-filter (the text beneath showed through sharp, reading as a
   * glitch), so this stands in for the blurred wash: a 14px blur of a mostly-background page averages to the page
   * background, so the bar is surface at 72% over the page background, made opaque. With nothing beneath (default),
   * the plain 72% tint is exact.
   */
  blur?: boolean;
  mode?: Mode;
  style?: React.CSSProperties;
};

/**
 * `header.glass sticky border-b` > `flex h-14 items-center gap-2 px-3`: IconButton "Open menu" (ghost size-10, Menu),
 * PropertySwitcher (h-10 rounded-lg border bg-surface px-3 text-sm 500 shadow-xs: swatch, name, ChevronsUpDown),
 * then ml-auto the UserMenu (size-10 round button around an md Avatar). The Starlite is a voice-only setup, so there
 * is no "Ask the agent" button (showAsk is false when setupPath is VOICE) and no ModeSwitch (hidden below sm).
 */
export const ConsoleHeader: React.FC<ConsoleHeaderProps> = ({property = STARLITE, user = 'Gus', blur = false, mode, style}) => {
  const t = useHO(mode);
  return (
    <header
      style={{
        ...uiFont,
        color: t.foreground,
        position: 'relative',
        zIndex: 40,
        // .glass = surface at 72% + saturate(180%) blur(14px) of whatever scrolls beneath (see `blur`).
        background: blur ? mix(t.background, t.surface, 0.72) : alpha(t.surface, 0.72),
        borderBottom: `1px solid ${t.border}`,
        ...style,
      }}
    >
      <div style={{display: 'flex', height: 56, alignItems: 'center', gap: 8, padding: '0 12px', boxSizing: 'border-box'}}>
        <span style={{display: 'inline-flex', width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: RADIUS.lg, color: t.foreground}}>
          <Icon name="menu" size={16} />
        </span>
        <div style={{display: 'flex', minWidth: 0, alignItems: 'center', gap: 8}}>
          <span
            style={{
              display: 'flex',
              height: 40,
              minWidth: 0,
              maxWidth: 240,
              alignItems: 'center',
              gap: 8,
              borderRadius: RADIUS.lg,
              border: `1px solid ${t.border}`,
              background: t.surface,
              padding: '0 12px',
              fontSize: 14,
              lineHeight: '20px',
              fontWeight: 500,
              boxShadow: shadow(t, 'xs'),
              boxSizing: 'border-box',
            }}
          >
            <span style={{width: 10, height: 10, flexShrink: 0, borderRadius: RADIUS.full, background: t.primary, boxShadow: `0 0 0 2px ${t.background}`}} />
            <span style={{overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{property}</span>
            <Icon name="chevrons-up-down" size={16} color={t.mutedForeground} style={{marginLeft: 'auto'}} />
          </span>
        </div>
        <div style={{marginLeft: 'auto', display: 'flex', flexShrink: 0, alignItems: 'center', gap: 6}}>
          <span style={{display: 'flex', width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: RADIUS.full}}>
            <Avatar name={user} size={36} mode={mode} />
          </span>
        </div>
      </div>
    </header>
  );
};

// ─── PageHeader ─────────────────────────────────────────────────────────────

/** primitives.tsx PageHeader on phones: `flex flex-col gap-4`; h1 text-2xl 600 tracking-tight; description mt-1.5 text-sm leading-relaxed muted; actions flex-wrap gap-2. */
export const PageHeader: React.FC<{title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; mode?: Mode}> = ({title, description, actions, mode}) => {
  const t = useHO(mode);
  return (
    <div style={{display: 'flex', flexDirection: 'column', gap: 16}}>
      <div style={{minWidth: 0}}>
        <h1 style={{margin: 0, fontSize: 24, lineHeight: '32px', fontWeight: 600, letterSpacing: '-0.025em', textWrap: 'balance'} as React.CSSProperties}>{title}</h1>
        {description ? <p style={{margin: '6px 0 0', maxWidth: 672, fontSize: 14, lineHeight: 1.625, color: t.mutedForeground}}>{description}</p> : null}
      </div>
      {actions ? <div style={{display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, minWidth: 0}}>{actions}</div> : null}
    </div>
  );
};

// ─── The voice page, Messages tab ───────────────────────────────────────────

export type VoiceMessagesPageProps = {
  /** Newest first (inbox('night' | 'morning')). Only the open (NEW) ones are listed under "To handle". */
  requests: GuestRequest[];
  /** Per-request row effects (see RowFx). */
  fx?: Record<string, RowFx | undefined>;
  /**
   * The To handle / Done control. Default: derived from the requests ("To handle · N", "Done · M", value 0).
   * Pass labels/value/from to animate S24's layoutId spring.
   */
  segment?: Partial<Pick<SegmentedProps, 'options' | 'value' | 'from'>>;
  /**
   * Count shown on the section tab ("Messages · N"). Default: open requests. Note the app reads it from the voice
   * overview, which Mark done does not refetch, so after S24's tap the real tab still says "Messages · 2" (pass 2).
   */
  openCount?: number;
  /** Show the console header bar (default true). */
  header?: boolean;
  /**
   * Page scroll in CSS px. The console header is `sticky top-0`, so it stays pinned at the top of the viewport while
   * the page scrolls beneath its glass (use this rather than Screen's scrollY, which moves everything).
   */
  scrollY?: number;
  /** The header's glass-over-content state (default: on while scrollY > 0). */
  headerBlur?: boolean;
  /** Show the page title, description and section tabs (default true). */
  pageHeader?: boolean;
  property?: string;
  user?: string;
  /** Clip rows to the card while one slides out. */
  clip?: boolean;
  mode?: Mode;
};

/**
 * The whole page as a phone shows it: header bar, then FRAME (`px-4 pb-12 pt-5`, space-y-6): PageHeader "Voice front desk"
 * with the section tabs (md SegmentedControl, max-w-full; the row is wider than a phone so it scrolls to the selected
 * "Messages" and fades its start edge), then Requests (`space-y-4`: sm SegmentedControl + the inbox Card).
 * Render inside <Screen> (width < 640). Rows the fx collapses still count until the scene passes new labels.
 */
export const VoiceMessagesPage: React.FC<VoiceMessagesPageProps> = ({requests, fx, segment, openCount, header = true, scrollY = 0, headerBlur, pageHeader = true, property = STARLITE, user, clip, mode}) => {
  const open = requests.filter((r) => r.status === 'NEW');
  const done = requests.filter((r) => r.status === 'DONE');
  const options = segment?.options ?? [`To handle · ${open.length}`, `Done · ${done.length}`];
  const value = segment?.value ?? 0;
  const list = value === 0 ? open : done;
  const n = openCount ?? open.length;
  const t = useHO(mode);
  return (
    <div style={{...uiFont, position: 'relative', paddingTop: header ? HEADER_H : 0, color: t.foreground}}>
      {header ? (
        <ConsoleHeader property={property} user={user} blur={headerBlur ?? scrollY > 0} mode={mode} style={{position: 'absolute', top: 0, left: 0, right: 0}} />
      ) : null}
      {/* FRAME, below the 57px header (h-14 + border-b), scrolled under it */}
      <div style={{width: '100%', padding: '20px 16px 48px', boxSizing: 'border-box', transform: scrollY ? `translateY(${-scrollY}px)` : undefined}}>
        <div style={{display: 'flex', flexDirection: 'column', gap: 24}}>
          {pageHeader ? (
            <PageHeader
              title="Voice front desk"
              description={`The voice that answers for ${property} — on your booking page and your phone line.`}
              actions={<SegmentedControl options={['Overview', 'Settings', 'Phone & WhatsApp', `Messages${n ? ` · ${n}` : ''}`]} value={3} scrolled="end" mode={mode} />}
              mode={mode}
            />
          ) : null}
          <div style={{display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'flex-start'}}>
            <SegmentedControl options={options} value={value} size="sm" from={segment?.from} mode={mode} />
            <MessagesList requests={list} fx={fx} clip={clip} mode={mode} style={{alignSelf: 'stretch'}} />
          </div>
        </div>
      </div>
    </div>
  );
};
