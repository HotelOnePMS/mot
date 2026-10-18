// A generic smartphone with no OS branding: an aluminium-dark body (#1b1f27,
// the board's bezel), a punch-hole camera, a plain status bar and six screens:
// incoming call, contact card, calling (with timer), lock screen with a
// missed-call notification, call ended on the home screen, screen off, plus a
// custom screen for app UI (Gus's phone shows the HotelOne console).
//
// Everything is laid out on a fixed 400 x 820 CSS px body (screen 380 x 800)
// and scaled with CSS zoom to `width`, so text stays crisp at any size and
// PHONE_POINTS give exact frame positions for thumbs and tap ripples.
import React from 'react';
import {Icon, type IconName} from '../hotelone/icons.tsx';
import {MarkerCircle} from '../hotelone/Messages.tsx';
import {DARK, FONT, INTER_FEATURES, LIGHT, NIGHT} from '../theme.ts';

/** The board's phone bezel (S01, S06). */
export const PHONE_BEZEL = '#1b1f27';

/** Base geometry in CSS px (before zoom). */
export const PHONE = {w: 400, h: 820, bezel: 10, radius: 60, screenRadius: 50, screen: {w: 380, h: 800}} as const;

/** Tap targets and anchors in body units (0..400, 0..820). Map with phonePoint(). */
export const PHONE_POINTS = {
  /** Contact card: the green Call button (a full-width pill under the name, inside S06's macro crop). */
  call: {x: 200, y: 352},
  /** Calling / in call: the red end button. */
  end: {x: 200, y: 716},
  /** Incoming: accept (green) and decline (red). */
  accept: {x: 292, y: 700},
  decline: {x: 108, y: 700},
  /** Lock screen: the notification card's number line, centre (the S20 red string's end). */
  missedNumber: {x: 146, y: 365},
  /** Lock screen: the notification card's centre. */
  missedCard: {x: 200, y: 352},
  /** Earpiece / camera (top centre) and the screen centre. */
  camera: {x: 200, y: 32},
  center: {x: 200, y: 410},
} as const;
export type PhonePointName = keyof typeof PHONE_POINTS;

/** A PHONE_POINTS anchor in px relative to the phone's top-left, for a phone rendered `width` px wide. */
export const phonePoint = (name: PhonePointName, width: number): {x: number; y: number} => {
  const k = width / PHONE.w;
  return {x: PHONE_POINTS[name].x * k, y: PHONE_POINTS[name].y * k};
};
/** Rendered height for a width (the body is 400 x 820). */
export const phoneHeight = (width: number) => (width * PHONE.h) / PHONE.w;

/** "00:00" call timer from seconds. */
export const formatTimer = (sec: number): string => {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

export type PhoneTheme = 'dark' | 'light';
export type Wallpaper = 'ink' | 'red' | 'teal';

type Palette = {bg: string; bg2: string; fg: string; muted: string; surface: string; surfaceHi: string; green: string; red: string; hairline: string};
const PAL: Record<PhoneTheme, Palette> = {
  dark: {bg: DARK.background, bg2: NIGHT.ink, fg: NIGHT.ivory, muted: DARK.mutedForeground, surface: DARK.muted, surfaceHi: DARK.accent, green: DARK.success, red: DARK.destructive, hairline: DARK.border},
  light: {bg: LIGHT.background, bg2: LIGHT.surfaceSunken, fg: LIGHT.foreground, muted: LIGHT.mutedForeground, surface: LIGHT.muted, surfaceHi: LIGHT.accent, green: LIGHT.success, red: LIGHT.destructive, hairline: LIGHT.border},
};

const WALL: Record<Wallpaper, {top: string; mid: string; base: string}> = {
  ink: {top: DARK.surfaceRaised, mid: DARK.background, base: NIGHT.ink},
  red: {top: NIGHT.redDeep, mid: DARK.background, base: NIGHT.ink},
  teal: {top: NIGHT.tealDeep, mid: DARK.background, base: NIGHT.ink},
};

const rgba = (hex: string, a: number) => {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

const UI: React.CSSProperties = {fontFamily: FONT.ui, fontFeatureSettings: INTER_FEATURES, WebkitFontSmoothing: 'antialiased'};

// ─── Pieces ─────────────────────────────────────────────────────────────────

const StatusBar: React.FC<{time: string; color: string}> = ({time, color}) => (
  <div style={{position: 'absolute', left: 0, right: 0, top: 0, height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 30px 0 34px', boxSizing: 'border-box', color, ...UI}}>
    <span style={{fontSize: 16, fontWeight: 600, letterSpacing: '-0.01em', fontVariantNumeric: 'tabular-nums'}}>{time}</span>
    <span style={{display: 'flex', alignItems: 'center', gap: 7}}>
      {/* signal */}
      <svg width={18} height={12} viewBox="0 0 18 12" aria-hidden style={{display: 'block'}}>
        {[0, 1, 2, 3].map((i) => (
          <rect key={i} x={i * 4.7} y={9 - i * 3} width={3.2} height={3 + i * 3} rx={1} fill={color} />
        ))}
      </svg>
      <Icon name="wifi" size={16} color={color} strokeWidth={2.4} />
      {/* battery */}
      <svg width={27} height={13} viewBox="0 0 27 13" aria-hidden style={{display: 'block'}}>
        <rect x={0.75} y={0.75} width={22.5} height={11.5} rx={3.5} fill="none" stroke={color} strokeOpacity={0.45} strokeWidth={1.5} />
        <rect x={2.6} y={2.6} width={15} height={7.8} rx={2} fill={color} />
        <rect x={24.4} y={4.2} width={2} height={4.6} rx={1} fill={color} fillOpacity={0.45} />
      </svg>
    </span>
  </div>
);

const HomeIndicator: React.FC<{color: string}> = ({color}) => (
  <div style={{position: 'absolute', left: '50%', bottom: 10, width: 134, height: 5, marginLeft: -67, borderRadius: 3, background: color, opacity: 0.55}} />
);

/** lucide phone (the handset), rotated for "decline"/"end". */
const Handset: React.FC<{size: number; color: string; end?: boolean; wiggle?: number}> = ({size, color, end, wiggle = 0}) => (
  <Icon name="phone" size={size} color={color} strokeWidth={2} style={{transform: `rotate(${(end ? 135 : 0) + wiggle}deg)`, fill: color, fillOpacity: 1}} />
);

const RoundButton: React.FC<{cx: number; cy: number; d: number; bg: string; children: React.ReactNode; label?: string; labelColor?: string; ring?: number; ringColor?: string; press?: number}> = ({cx, cy, d, bg, children, label, labelColor, ring = 0, ringColor, press = 0}) => {
  const r = clamp01(ring);
  const s = 1 - 0.06 * clamp01(press);
  return (
    <>
      {r > 0 ? (
        <div style={{position: 'absolute', left: cx - d / 2, top: cy - d / 2, width: d, height: d, borderRadius: '50%', border: `3px solid ${ringColor ?? bg}`, opacity: 0.55 * (1 - r), transform: `scale(${1 + r * 0.55})`, boxSizing: 'border-box'}} />
      ) : null}
      <div
        style={{
          position: 'absolute',
          left: cx - d / 2,
          top: cy - d / 2,
          width: d,
          height: d,
          borderRadius: '50%',
          background: bg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transform: s !== 1 ? `scale(${s})` : undefined,
          boxShadow: `inset 0 1px 0 ${rgba(NIGHT.ivory, 0.18)}, 0 6px 18px -6px ${rgba(NIGHT.ink, 0.6)}`,
        }}
      >
        {children}
      </div>
      {label ? (
        <div style={{position: 'absolute', left: cx - 60, width: 120, top: cy + d / 2 + 10, textAlign: 'center', fontSize: 14, fontWeight: 500, color: labelColor, ...UI}}>{label}</div>
      ) : null}
    </>
  );
};

const AvatarCircle: React.FC<{cx: number; cy: number; d: number; initials?: string; color: string; fg: string; icon?: IconName; ring?: number}> = ({cx, cy, d, initials, color, fg, icon, ring = 0}) => (
  <>
    {ring > 0
      ? [0, 0.5].map((o) => {
          const q = (ring + o) % 1;
          return <div key={o} style={{position: 'absolute', left: cx - d / 2, top: cy - d / 2, width: d, height: d, borderRadius: '50%', background: color, opacity: 0.22 * (1 - q), transform: `scale(${1 + q * 0.7})`}} />;
        })
      : null}
    <div
      style={{
        position: 'absolute',
        left: cx - d / 2,
        top: cy - d / 2,
        width: d,
        height: d,
        borderRadius: '50%',
        background: `radial-gradient(circle at 34% 28%, ${rgba(NIGHT.ivory, 0.22)}, transparent 62%), ${color}`,
        color: fg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: d * 0.42,
        fontWeight: 600,
        letterSpacing: '-0.02em',
        boxShadow: `0 10px 30px -10px ${rgba(NIGHT.ink, 0.7)}`,
        ...UI,
      }}
    >
      {icon ? <Icon name={icon} size={d * 0.44} color={fg} /> : initials}
    </div>
  </>
);

const Centered: React.FC<{top: number; children: React.ReactNode; style?: React.CSSProperties}> = ({top, children, style}) => (
  <div style={{position: 'absolute', left: 20, right: 20, top, textAlign: 'center', ...UI, ...style}}>{children}</div>
);

/** A soft white touch ripple (S06's tap): 40 px at rest, expanding and fading with progress 0..1. */
const Ripple: React.FC<{cx: number; cy: number; progress: number}> = ({cx, cy, progress}) => {
  const p = clamp01(progress);
  if (p <= 0 || p >= 1) return null;
  const d = 40 + p * 110;
  const k = Math.pow(1 - p, 0.8);
  return (
    <>
      <div style={{position: 'absolute', left: cx - d / 2, top: cy - d / 2, width: d, height: d, borderRadius: '50%', background: `radial-gradient(circle, ${rgba(NIGHT.ivory, 0.7)} 0%, ${rgba(NIGHT.ivory, 0.35)} 45%, transparent 70%)`, opacity: k}} />
      <div style={{position: 'absolute', left: cx - d / 2, top: cy - d / 2, width: d, height: d, borderRadius: '50%', border: `2px solid ${rgba(NIGHT.ivory, 0.6)}`, opacity: k, boxSizing: 'border-box'}} />
    </>
  );
};

// ─── Screens (380 x 800, screen coordinates) ───────────────────────────────

/** Screen-space point for a PHONE_POINTS name. */
const sp = (n: PhonePointName) => ({x: PHONE_POINTS[n].x - PHONE.bezel, y: PHONE_POINTS[n].y - PHONE.bezel});

export type IncomingProps = {name: string; subtitle?: string; initials?: string; avatarColor?: string; ring?: number; acceptPress?: number};
const IncomingScreen: React.FC<IncomingProps & {p: Palette}> = ({name, subtitle, initials, avatarColor, ring = 0, acceptPress, p}) => {
  const acc = sp('accept');
  const dec = sp('decline');
  return (
    <>
      <Centered top={118}>
        <div style={{fontSize: 18, fontWeight: 500, color: p.muted}}>Incoming call</div>
        <div style={{marginTop: 10, fontSize: 32, lineHeight: 1.15, fontWeight: 600, letterSpacing: '-0.02em', color: p.fg}}>{name}</div>
        {subtitle ? <div style={{marginTop: 8, fontSize: 16, fontWeight: 400, color: p.muted}}>{subtitle}</div> : null}
      </Centered>
      <AvatarCircle cx={190} cy={400} d={128} initials={initials} icon={initials ? undefined : 'user'} color={avatarColor ?? p.surfaceHi} fg={initials ? NIGHT.ivory : p.muted} ring={ring} />
      <RoundButton cx={dec.x} cy={dec.y} d={78} bg={p.red} label="Decline" labelColor={p.muted}>
        <Handset size={32} color={NIGHT.ivory} end />
      </RoundButton>
      <RoundButton cx={acc.x} cy={acc.y} d={78} bg={p.green} label="Accept" labelColor={p.muted} ring={ring} press={acceptPress}>
        <Handset size={32} color={NIGHT.ivory} wiggle={ring > 0 ? Math.sin(ring * Math.PI * 6) * 10 * (1 - ring) : 0} />
      </RoundButton>
    </>
  );
};

export type ContactProps = {name: string; subtitle?: string; initials?: string; avatarColor?: string; number?: string; callPress?: number};
const ContactScreen: React.FC<ContactProps & {p: Palette}> = ({name, subtitle, initials, avatarColor, number, callPress = 0, p}) => {
  const call = sp('call');
  const actions: Array<{icon: IconName; label: string}> = [
    {icon: 'message-circle', label: 'Message'},
    {icon: 'video', label: 'Video'},
    {icon: 'mail', label: 'Mail'},
  ];
  const s = 1 - 0.04 * clamp01(callPress);
  return (
    <>
      <div style={{position: 'absolute', left: 16, top: 60, display: 'flex', alignItems: 'center', gap: 2, color: p.muted, fontSize: 16, fontWeight: 500, ...UI}}>
        <Icon name="chevron-left" size={24} color={p.muted} /> Contacts
      </div>
      <div style={{position: 'absolute', right: 22, top: 62, color: p.muted, fontSize: 16, fontWeight: 500, ...UI}}>Edit</div>
      <AvatarCircle cx={190} cy={156} d={104} initials={initials ?? name.slice(0, 1).toUpperCase()} color={avatarColor ?? NIGHT.teal} fg={NIGHT.ivory} />
      <Centered top={222}>
        <div style={{fontSize: 28, lineHeight: 1.15, fontWeight: 600, letterSpacing: '-0.02em', color: p.fg}}>{name}</div>
        {subtitle ? <div style={{marginTop: 6, fontSize: 16, color: p.muted}}>{subtitle}</div> : null}
      </Centered>
      {/* the green Call pill */}
      <div
        style={{
          position: 'absolute',
          left: 28,
          right: 28,
          top: call.y - 32,
          height: 64,
          borderRadius: 32,
          background: `linear-gradient(180deg, ${rgba(NIGHT.ivory, 0.14)} 0%, transparent 60%), ${p.green}`,
          boxShadow: `inset 0 1px 0 ${rgba(NIGHT.ivory, 0.25)}, 0 10px 24px -10px ${rgba(p.green, 0.7)}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          color: NIGHT.ivory,
          fontSize: 20,
          fontWeight: 600,
          transform: s !== 1 ? `scale(${s})` : undefined,
          ...UI,
        }}
      >
        <Handset size={24} color={NIGHT.ivory} />
        Call
      </div>
      <div style={{position: 'absolute', left: 28, right: 28, top: 404, display: 'flex', gap: 12}}>
        {actions.map((a) => (
          <div key={a.label} style={{flex: 1, height: 66, borderRadius: 18, background: p.surface, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, color: p.fg, fontSize: 13, fontWeight: 500, ...UI}}>
            <Icon name={a.icon} size={22} color={p.fg} />
            {a.label}
          </div>
        ))}
      </div>
      <div style={{position: 'absolute', left: 28, right: 28, top: 490, borderRadius: 18, background: p.surface, overflow: 'hidden', ...UI}}>
        {number ? (
          <div style={{padding: '12px 18px', borderBottom: `1px solid ${p.hairline}`}}>
            <div style={{fontSize: 13, color: p.muted}}>phone</div>
            <div style={{marginTop: 2, fontSize: 18, fontWeight: 500, color: NIGHT.tealSoft, fontVariantNumeric: 'tabular-nums'}}>{number}</div>
          </div>
        ) : null}
        {['Share contact', 'Add to favourites'].map((label, i, all) => (
          <div key={label} style={{padding: '15px 18px', fontSize: 16, fontWeight: 500, color: NIGHT.tealSoft, borderBottom: i < all.length - 1 ? `1px solid ${p.hairline}` : undefined}}>
            {label}
          </div>
        ))}
      </div>
    </>
  );
};

export type CallingProps = {name: string; status?: string; elapsed?: number; initials?: string; avatarColor?: string; endPress?: number; ended?: boolean};
const CallingScreen: React.FC<CallingProps & {p: Palette}> = ({name, status = 'Calling…', elapsed = 0, initials, avatarColor, endPress, ended, p}) => {
  const end = sp('end');
  const grid: Array<{icon: IconName; label: string}> = [
    {icon: 'mic-off', label: 'Mute'},
    {icon: 'grid-3x3', label: 'Keypad'},
    {icon: 'volume-2', label: 'Speaker'},
    {icon: 'user-plus', label: 'Add call'},
    {icon: 'video', label: 'Video'},
    {icon: 'user', label: 'Contacts'},
  ];
  return (
    <>
      <AvatarCircle cx={190} cy={176} d={108} initials={initials ?? name.slice(0, 1).toUpperCase()} color={avatarColor ?? NIGHT.teal} fg={NIGHT.ivory} />
      <Centered top={254}>
        <div style={{fontSize: 30, lineHeight: 1.15, fontWeight: 600, letterSpacing: '-0.02em', color: p.fg}}>{name}</div>
        <div style={{marginTop: 10, fontSize: 18, fontWeight: 500, color: ended ? p.red : p.muted}}>{ended ? 'Call ended' : status}</div>
        <div style={{marginTop: 6, fontSize: 18, fontWeight: 500, color: p.muted, fontVariantNumeric: 'tabular-nums', letterSpacing: '0.02em'}}>{formatTimer(elapsed)}</div>
      </Centered>
      <div style={{position: 'absolute', left: 38, right: 38, top: 430, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', rowGap: 26, opacity: ended ? 0.35 : 1}}>
        {grid.map((g) => (
          <div key={g.label} style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9, ...UI}}>
            <div style={{width: 70, height: 70, borderRadius: '50%', background: p.surface, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
              <Icon name={g.icon} size={26} color={p.fg} />
            </div>
            <span style={{fontSize: 13, fontWeight: 500, color: p.muted}}>{g.label}</span>
          </div>
        ))}
      </div>
      <RoundButton cx={end.x} cy={end.y} d={80} bg={ended ? p.surfaceHi : p.red} press={endPress}>
        <Handset size={34} color={NIGHT.ivory} end />
      </RoundButton>
    </>
  );
};

export type Notification = {title: string; body: string; time: string; icon?: IconName; iconBg?: string};

const NotificationCard: React.FC<{n: Notification; top: number; glow?: number; circle?: {progress: number; color?: string}}> = ({n, top, glow = 0, circle}) => (
  <div
    style={{
      position: 'absolute',
      left: 14,
      right: 14,
      top,
      height: 84,
      borderRadius: 24,
      background: rgba(NIGHT.ivory, 0.97),
      boxShadow: `0 10px 30px -10px ${rgba(NIGHT.ink, 0.8)}${glow > 0 ? `, 0 0 ${40 * glow}px ${rgba(NIGHT.ivory, 0.35 * glow)}` : ''}`,
      display: 'flex',
      alignItems: 'center',
      gap: 14,
      padding: '0 18px 0 16px',
      boxSizing: 'border-box',
      ...UI,
    }}
  >
    <div style={{width: 42, height: 42, borderRadius: 12, background: n.iconBg ?? LIGHT.destructive, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0}}>
      <Icon name={n.icon ?? 'phone-missed'} size={22} color={NIGHT.ivory} strokeWidth={2.2} />
    </div>
    <div style={{flex: 1, minWidth: 0}}>
      <div style={{display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8}}>
        <span style={{fontSize: 17, fontWeight: 600, color: LIGHT.foreground}}>{n.title}</span>
        <span style={{fontSize: 14, fontWeight: 400, color: LIGHT.mutedForeground, whiteSpace: 'nowrap'}}>{n.time}</span>
      </div>
      <div style={{marginTop: 3, fontSize: 17, fontWeight: 500, color: LIGHT.mutedForeground, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap'}}>
        <span style={{position: 'relative', display: 'inline-block'}}>
          {n.body}
          {circle && circle.progress > 0 ? <MarkerCircle progress={circle.progress} color={circle.color ?? NIGHT.red} pad={9} strokeWidth={3} seed="lockNumber" /> : null}
        </span>
      </div>
    </div>
  </div>
);

const WallpaperBg: React.FC<{w: Wallpaper}> = ({w}) => {
  const c = WALL[w];
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: `radial-gradient(120% 70% at 50% 0%, ${c.top} 0%, ${c.mid} 58%, ${c.base} 100%)`,
      }}
    >
      {/* a quiet abstract horizon so the lock screen is not a flat fill */}
      <svg width="380" height="800" viewBox="0 0 380 800" style={{position: 'absolute', inset: 0}} aria-hidden>
        <path d="M0 560 C 90 520 170 540 240 512 S 340 470 380 480 L380 800 L0 800 Z" fill={rgba(NIGHT.ink, 0.45)} />
        <path d="M0 640 C 110 600 210 628 290 600 S 360 584 380 590 L380 800 L0 800 Z" fill={rgba(NIGHT.ink, 0.55)} />
      </svg>
    </div>
  );
};

export type LockProps = {time: string; date?: string; notification?: Notification; wallpaper?: Wallpaper; notificationGlow?: number; numberCircle?: {progress: number; color?: string}};
const LockScreen: React.FC<LockProps & {p: Palette}> = ({time, date, notification, wallpaper = 'ink', notificationGlow, numberCircle}) => (
  <>
    <WallpaperBg w={wallpaper} />
    <div style={{position: 'absolute', left: 0, right: 0, top: 62, display: 'flex', justifyContent: 'center'}}>
      <Icon name="lock" size={20} color={NIGHT.ivory} strokeWidth={2.2} />
    </div>
    <Centered top={date ? 96 : 104}>
      {date ? <div style={{fontSize: 18, fontWeight: 500, color: rgba(NIGHT.ivory, 0.85)}}>{date}</div> : null}
      <div style={{fontSize: 118, lineHeight: 1.05, fontWeight: 500, letterSpacing: '-0.05em', color: NIGHT.ivory, fontVariantNumeric: 'tabular-nums', textShadow: `0 4px 30px ${rgba(NIGHT.ink, 0.5)}`}}>{time}</div>
    </Centered>
    {notification ? <NotificationCard n={notification} top={PHONE_POINTS.missedCard.y - PHONE.bezel - 42} glow={notificationGlow} circle={numberCircle} /> : null}
    {(['flashlight', 'camera'] as const).map((ic, i) => (
      <div key={ic} style={{position: 'absolute', left: i === 0 ? 46 : 380 - 46 - 52, top: 690, width: 52, height: 52, borderRadius: '50%', background: rgba(NIGHT.ink, 0.45), boxShadow: `inset 0 0 0 1px ${rgba(NIGHT.ivory, 0.08)}`, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
        <Icon name={ic} size={22} color={NIGHT.ivory} />
      </div>
    ))}
  </>
);

export type HomeProps = {time: string; date?: string; banner?: Notification; wallpaper?: Wallpaper; bannerIn?: number};
const APPS: IconName[] = ['calendar', 'camera', 'image', 'map-pin', 'clock', 'music', 'mail', 'settings'];
const DOCK: IconName[] = ['phone', 'message-circle', 'globe', 'camera'];
const HomeScreen: React.FC<HomeProps & {p: Palette}> = ({time, date, banner, wallpaper = 'ink', bannerIn = 1}) => {
  const k = clamp01(bannerIn);
  return (
    <>
      <WallpaperBg w={wallpaper} />
      <Centered top={96 + (banner ? 64 * k : 0)}>
        <div style={{fontSize: 64, lineHeight: 1, fontWeight: 500, letterSpacing: '-0.04em', color: NIGHT.ivory, fontVariantNumeric: 'tabular-nums'}}>{time}</div>
        {date ? <div style={{marginTop: 8, fontSize: 16, fontWeight: 500, color: rgba(NIGHT.ivory, 0.75)}}>{date}</div> : null}
      </Centered>
      <div style={{position: 'absolute', left: 30, right: 30, top: 300, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', rowGap: 26, justifyItems: 'center'}}>
        {APPS.map((a, i) => (
          <div key={a} style={{width: 62, height: 62, borderRadius: 18, background: i % 3 === 0 ? DARK.accent : i % 3 === 1 ? DARK.muted : DARK.surfaceRaised, boxShadow: `inset 0 1px 0 ${rgba(NIGHT.ivory, 0.08)}`, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
            <Icon name={a} size={26} color={rgba(NIGHT.ivory, 0.82)} />
          </div>
        ))}
      </div>
      <div style={{position: 'absolute', left: 16, right: 16, bottom: 26, height: 92, borderRadius: 32, background: rgba(NIGHT.ivory, 0.07), display: 'flex', alignItems: 'center', justifyContent: 'space-around', padding: '0 10px'}}>
        {DOCK.map((a, i) => (
          <div key={a} style={{width: 62, height: 62, borderRadius: 18, background: i === 0 ? DARK.success : DARK.accent, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
            <Icon name={a} size={27} color={NIGHT.ivory} />
          </div>
        ))}
      </div>
      {banner && k > 0 ? (
        // Banners slide down over the status bar, as on a real phone (zIndex above the StatusBar drawn after the content).
        <div style={{position: 'absolute', inset: 0, zIndex: 2, transform: `translateY(${(1 - k) * -120}px)`, opacity: k}}>
          <NotificationCard n={banner} top={58} />
        </div>
      ) : null}
    </>
  );
};

// ─── The phone ──────────────────────────────────────────────────────────────

export type GenericPhoneScreen = 'incoming' | 'contact' | 'calling' | 'lock' | 'home' | 'off' | 'custom';

export type GenericPhoneProps = {
  /** Rendered width of the body in px (height = width x 2.05). */
  width: number;
  screen: GenericPhoneScreen;
  /** Dark OS UI (Rita's phone, default) or light. Lock/home always sit on a dark wallpaper. */
  theme?: PhoneTheme;
  /** Status-bar time, e.g. "2:21". */
  time?: string;
  /** Caller / contact name or number (incoming, contact, calling). */
  name?: string;
  subtitle?: string;
  /** Avatar initials (contact card default: first letter of name) and colour (default teal). */
  initials?: string;
  avatarColor?: string;
  /** Contact card: an optional phone-number row. */
  number?: string;
  /** Calling: status line (default "Calling…"), seconds on the timer, and the ended state ("Call ended", frozen timer). */
  status?: string;
  elapsed?: number;
  ended?: boolean;
  /** Incoming: 0..1 ring pulse (halo + handset wiggle). Loop it per ring. */
  ring?: number;
  /** Lock screen: big time, date line, the notification card and its glow (0..1). */
  lockTime?: string;
  date?: string;
  notification?: Notification;
  notificationGlow?: number;
  /** Lock screen: a red marker circle drawn around the notification's number (S20), progress 0..1. */
  numberCircle?: {progress: number; color?: string};
  /** Home screen: a banner (e.g. "Call ended") sliding in with bannerIn 0..1. */
  banner?: Notification;
  bannerIn?: number;
  wallpaper?: Wallpaper;
  /** 0..1 press on the main button of the screen (call / end / accept). */
  press?: number;
  /** A tap ripple at a PHONE_POINTS anchor, progress 0..1. */
  tap?: {at: PhonePointName; progress: number};
  /** 0..1 screen brightness (0 = off-black). Default 1. */
  brightness?: number;
  /** Custom screen content (screen === 'custom'), laid out in 380 x 800 CSS px. */
  children?: React.ReactNode;
  /** Draw the status bar over custom content (default true). */
  statusBar?: boolean;
  /** Custom screen background (default the theme background). */
  screenBg?: string;
  /** Rim light colour on the body edge (teal / red world), and its strength 0..1. */
  rim?: string;
  rimAmount?: number;
  /** Draw the body and bezel (default true). false renders just the 380 x 800 screen (zoomed to width x 0.95). */
  frame?: boolean;
  style?: React.CSSProperties;
};

/**
 * A generic phone at `width` px. Absolute-position it yourself; use phonePoint() for anchors.
 * Example (S06): <GenericPhone width={520} screen="contact" name="Starlite — front desk" time="2:21" />
 */
export const GenericPhone: React.FC<GenericPhoneProps> = ({
  width,
  screen,
  theme = 'dark',
  time = '2:21',
  name = '',
  subtitle,
  initials,
  avatarColor,
  number,
  status,
  elapsed,
  ended,
  ring,
  lockTime,
  date,
  notification,
  notificationGlow,
  numberCircle,
  banner,
  bannerIn,
  wallpaper,
  press,
  tap,
  brightness = 1,
  children,
  statusBar = true,
  screenBg,
  rim,
  rimAmount = 0.6,
  frame = true,
  style,
}) => {
  const p = PAL[theme];
  const onWallpaper = screen === 'lock' || screen === 'home';
  const statusColor = onWallpaper || theme === 'dark' ? NIGHT.ivory : LIGHT.foreground;
  const bg = screen === 'off' ? NIGHT.ink : screenBg ?? `linear-gradient(180deg, ${p.bg} 0%, ${p.bg2} 100%)`;
  const b = clamp01(brightness);

  let content: React.ReactNode = null;
  if (screen === 'incoming') content = <IncomingScreen p={p} name={name} subtitle={subtitle} initials={initials} avatarColor={avatarColor} ring={ring} acceptPress={press} />;
  else if (screen === 'contact') content = <ContactScreen p={p} name={name} subtitle={subtitle} initials={initials} avatarColor={avatarColor} number={number} callPress={press} />;
  else if (screen === 'calling') content = <CallingScreen p={p} name={name} status={status} elapsed={elapsed} initials={initials} avatarColor={avatarColor} endPress={press} ended={ended} />;
  else if (screen === 'lock') content = <LockScreen p={p} time={lockTime ?? time} date={date} notification={notification} wallpaper={wallpaper} notificationGlow={notificationGlow} numberCircle={numberCircle} />;
  else if (screen === 'home') content = <HomeScreen p={p} time={lockTime ?? time} date={date} banner={banner} wallpaper={wallpaper} bannerIn={bannerIn} />;
  else if (screen === 'custom') content = children;

  const tapPt = tap ? sp(tap.at) : null;

  const screenEl = (
    <div style={{position: 'relative', width: PHONE.screen.w, height: PHONE.screen.h, overflow: 'hidden', borderRadius: frame ? PHONE.screenRadius : 0, background: bg, ...UI}}>
      {content}
      {screen === 'off' ? (
        <svg width="380" height="800" viewBox="0 0 380 800" style={{position: 'absolute', inset: 0}} aria-hidden>
          <path d="M0 420 L380 120 L380 190 L0 490 Z" fill={rgba(NIGHT.ivory, 0.04)} />
          <path d="M0 520 L380 220 L380 236 L0 536 Z" fill={rgba(NIGHT.ivory, 0.03)} />
        </svg>
      ) : null}
      {screen !== 'off' && (screen !== 'custom' || statusBar) ? <StatusBar time={time} color={statusColor} /> : null}
      {screen !== 'off' && screen !== 'custom' ? <HomeIndicator color={statusColor} /> : null}
      {tapPt ? <Ripple cx={tapPt.x} cy={tapPt.y} progress={tap!.progress} /> : null}
      {b < 1 ? <div style={{position: 'absolute', inset: 0, background: NIGHT.ink, opacity: 1 - b}} /> : null}
    </div>
  );

  if (!frame) {
    return <div style={{width: PHONE.screen.w, height: PHONE.screen.h, zoom: width / PHONE.screen.w, ...style}}>{screenEl}</div>;
  }

  const rimC = rim ?? DARK.borderStrong;
  return (
    <div style={{position: 'relative', width: PHONE.w, height: PHONE.h, zoom: width / PHONE.w, ...style}}>
      {/* side keys */}
      <div style={{position: 'absolute', left: -3, top: 170, width: 5, height: 62, borderRadius: 3, background: PHONE_BEZEL, boxShadow: `inset 1px 0 0 ${rgba(rimC, 0.5)}`}} />
      <div style={{position: 'absolute', left: -3, top: 246, width: 5, height: 62, borderRadius: 3, background: PHONE_BEZEL, boxShadow: `inset 1px 0 0 ${rgba(rimC, 0.5)}`}} />
      <div style={{position: 'absolute', right: -3, top: 210, width: 5, height: 92, borderRadius: 3, background: PHONE_BEZEL, boxShadow: `inset -1px 0 0 ${rgba(rimC, 0.5)}`}} />
      {/* body */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: PHONE.radius,
          background: `linear-gradient(135deg, ${rgba(rimC, 0.16 * rimAmount)} 0%, ${PHONE_BEZEL} 22%, ${PHONE_BEZEL} 78%, ${rgba(rimC, 0.1 * rimAmount)} 100%), ${PHONE_BEZEL}`,
          boxShadow: `inset 0 0 0 1.5px ${rgba(rimC, 0.55 * rimAmount)}, inset 0 0 0 4px ${PHONE_BEZEL}, inset 0 0 0 5px ${rgba(NIGHT.ink, 0.9)}, 0 30px 60px -20px ${rgba(NIGHT.ink, 0.9)}`,
        }}
      />
      {/* screen */}
      <div style={{position: 'absolute', left: PHONE.bezel, top: PHONE.bezel, borderRadius: PHONE.screenRadius, boxShadow: `0 0 0 2px ${NIGHT.ink}`}}>
        {screenEl}
        {/* glass: a faint diagonal sheen */}
        <div style={{position: 'absolute', inset: 0, borderRadius: PHONE.screenRadius, background: `linear-gradient(118deg, ${rgba(NIGHT.ivory, 0.06)} 0%, transparent 34%, transparent 100%)`, pointerEvents: 'none'}} />
      </div>
      {/* punch-hole camera */}
      <div style={{position: 'absolute', left: PHONE_POINTS.camera.x - 8, top: PHONE_POINTS.camera.y - 8, width: 16, height: 16, borderRadius: '50%', background: `radial-gradient(circle at 40% 38%, ${DARK.accent} 0%, ${NIGHT.ink} 55%)`, boxShadow: `0 0 0 2px ${rgba(NIGHT.ink, 0.9)}`}} />
    </div>
  );
};
