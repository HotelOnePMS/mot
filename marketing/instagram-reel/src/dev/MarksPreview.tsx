// Dev monitor for src/marks.ts: plays the whole film clock and lists the marks
// around the current frame. A row lights brass on the frames it is active, so
// any frame can be checked against the board (and against the mix).
import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {loadFonts} from '../fonts.ts';
import {FPS, SHOTS, TOTAL_FRAMES, f} from '../timeline.ts';
import {CLOCK_TICKS, GUS_CHIMES, HEARTBEAT, MARKS, MOTIFS, SFX, TRILLS, activeStep, toLocalFrame, S02_COUNTER, S07_COUNTER, TWIST_COUNTER, S27_COUNTER} from '../marks.ts';
import {FONT, NIGHT} from '../theme.ts';

loadFonts();

type Row = {label: string; t: number; end: number};
const LENGTH_KEYS = new Set(['frames', 'dur', 'hz']);

/** Flattens every shot's marks into rows: numbers are instants, {start,end} spans, {t,frames}/{t,dur} windows. */
const flatten = (v: unknown, label: string, out: Row[]): void => {
  if (typeof v === 'number') {
    out.push({label, t: v, end: v + 1 / FPS});
  } else if (Array.isArray(v)) {
    v.forEach((x, i) => flatten(x, `${label}[${i}]`, out));
  } else if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.t === 'number') {
      const len = typeof o.frames === 'number' ? o.frames / FPS : typeof o.dur === 'number' ? o.dur : 1 / FPS;
      out.push({label: typeof o.label === 'string' ? `${label} ${o.label}` : typeof o.text === 'string' ? `${label} ${o.text}` : label, t: o.t, end: o.t + len});
      return;
    }
    if (typeof o.start === 'number' && typeof o.end === 'number' && Object.keys(o).length === 2) {
      out.push({label, t: o.start, end: o.end});
      return;
    }
    for (const [k, x] of Object.entries(o)) if (!LENGTH_KEYS.has(k)) flatten(x, `${label}.${k}`, out);
  }
};

const ROWS: Row[] = (() => {
  const out: Row[] = [];
  for (const [id, m] of Object.entries(MARKS)) flatten(m, id, out);
  TRILLS.forEach((t) => out.push({label: 'TRILL', t, end: t + 0.6}));
  GUS_CHIMES.forEach((t) => out.push({label: 'GUS CHIME', t, end: t + 0.25}));
  HEARTBEAT.forEach((t) => out.push({label: 'heartbeat', t, end: t + 2 / FPS}));
  CLOCK_TICKS.forEach((t) => out.push({label: 'clock tick', t, end: t + 1 / FPS}));
  MOTIFS.forEach((m) => m.notes.forEach((t, i) => out.push({label: `motif ${m.mode} #${i + 1} (${m.voice})`, t, end: t + 1 / FPS})));
  SFX.forEach((x) => out.push({label: `sfx ${x.id}${x.note ? ` · ${x.note}` : ''}`, t: x.t, end: x.end ?? x.t + 1 / FPS}));
  return out.sort((a, b) => a.t - b.t);
})();

const COUNTERS = [
  {scene: 'Binoculars', steps: S02_COUNTER},
  {scene: 'TheCall', steps: S07_COUNTER},
  {scene: 'Twist', steps: TWIST_COUNTER},
  {scene: 'Stinger', steps: S27_COUNTER},
];

const MarksMonitor: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const sh = SHOTS.find((x) => frame >= x.from && frame < x.to) ?? SHOTS[SHOTS.length - 1];
  const near = ROWS.filter((r) => r.end >= t - 1.2 && r.t <= t + 1.2).slice(0, 26);
  const counter = COUNTERS.find((c) => c.scene === sh.scene);
  const step = counter ? activeStep(counter.steps, toLocalFrame(t, sh.scene), sh.scene) : null;
  return (
    <AbsoluteFill style={{background: NIGHT.ink, color: NIGHT.ivory, fontFamily: FONT.mono, padding: '120px 90px'}}>
      <div style={{fontSize: 30, color: NIGHT.grey, letterSpacing: '0.08em'}}>MARKS · EVENT CLOCK</div>
      <div style={{fontSize: 72, fontWeight: 500, marginTop: 12}}>
        {t.toFixed(3)} s <span style={{color: NIGHT.tealSoft}}>f{frame}</span>
      </div>
      <div style={{fontSize: 34, color: NIGHT.brass, marginTop: 8}}>
        {sh.id} · {sh.scene} · local f{frame - SHOTS.filter((x) => x.scene === sh.scene)[0].from}
      </div>
      <div style={{fontSize: 34, marginTop: 8, color: step ? NIGHT.redSoft : NIGHT.grey, height: 44}}>
        {step ? `counter ${step.step.label}${step.since < 2 ? ' · POP' : ''}` : ''}
      </div>
      <div style={{marginTop: 36, display: 'flex', flexDirection: 'column', gap: 6}}>
        {near.map((r, i) => {
          const on = frame >= f(r.t) && frame < Math.max(f(r.end), f(r.t) + 1);
          const past = frame >= Math.max(f(r.end), f(r.t) + 1);
          return (
            <div key={`${r.label}-${i}`} style={{display: 'flex', gap: 24, fontSize: 26, lineHeight: '40px', padding: '0 14px', borderRadius: 8, background: on ? NIGHT.brass : 'transparent', color: on ? NIGHT.ink : past ? NIGHT.grey : NIGHT.ivory, opacity: past && !on ? 0.55 : 1}}>
              <span style={{width: 130}}>{r.t.toFixed(3)}</span>
              <span style={{width: 90}}>f{f(r.t)}</span>
              <span style={{flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{r.label}</span>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

export const preview = {id: 'MarksPreview', component: MarksMonitor, durationInFrames: TOTAL_FRAMES};
