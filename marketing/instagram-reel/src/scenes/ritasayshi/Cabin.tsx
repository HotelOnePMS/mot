// The four cabin layers in draw order (car back, Rita body, light spills, car front, Rita front) plus the
// scene's light: teal wash from the Starlite through the windshield, the phone's voice spill at her ear,
// and the screen light on her face when she looks down at the phone.
import React from 'react';
import {AbsoluteFill} from 'remotion';
import {CarInterior, type CarCamera, type StenoNotes} from '../../set/CarInterior.tsx';
import {RitaA, type RitaPose} from '../../char/Rita.tsx';
import {missedPulse} from '../../marks.ts';
import {NIGHT} from '../../theme.ts';
import type {P} from '../../char/rig.ts';
import {camT, points} from './common.ts';

/** Story time: the same night as S07–S13 (the Starlite's LED clock read 2:21 when the AI picked up). */
export const STORY_CLOCK = '2:21';
const OFFICE = {clock: STORY_CLOCK, phoneState: 'dark'} as const;
/** Everything she has written by now (S04, S11, S12). */
const NOTES: StenoNotes = {nights: 4, tonight: 1, fri: 1, price: 1, underline: 1, margin: 1};

export type Spill = {
  /** 0..1 teal from the Starlite sign across the windshield side of her face (S15). */
  wash?: number;
  /** 0..1 the AI's voice breathing teal out of the phone at her ear. */
  voice?: number;
  /** 0..1 the screen's light on her face while she looks down at it (S16, before the tap). */
  screen?: number;
};

const rot = (p: P, deg: number): P => {
  const a = (deg * Math.PI) / 180;
  return [p[0] * Math.cos(a) - p[1] * Math.sin(a), p[0] * Math.sin(a) + p[1] * Math.cos(a)];
};

/** Light on Rita, in cabin (rest) px under the camera, screen-blended. */
const Spills: React.FC<{camera: CarCamera; pose: RitaPose; spill: Spill; id: string}> = ({camera, pose, spill, id}) => {
  const {wash = 0, voice = 0, screen = 0} = spill;
  if (wash <= 0.001 && voice <= 0.001 && screen <= 0.001) return null;
  const pts = points(pose);
  const lens = pts.lensFar;
  const mouth = pts.mouth;
  // the phone's screen-side edge (toward her face), phone-local px rotated by its angle
  const ph = pts.phone;
  const ear = rot([30, -20], pts.phoneDeg);
  const voiceAt: P = [ph[0] + ear[0], ph[1] + ear[1]];
  // screen light: rises from the phone toward her chin and glasses
  const scr: P = [ph[0] * 0.55 + mouth[0] * 0.45 + 10, ph[1] * 0.55 + mouth[1] * 0.45];
  return (
    <svg width={1080} height={1920} viewBox="0 0 1080 1920" style={{position: 'absolute', inset: 0, mixBlendMode: 'screen', pointerEvents: 'none'}}>
      <defs>
        <radialGradient id={`${id}w`} cx={lens[0] + 24} cy={lens[1] + 46} r={170} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={NIGHT.tealBright} stopOpacity={0.42} />
          <stop offset="0.5" stopColor={NIGHT.teal} stopOpacity={0.14} />
          <stop offset="1" stopColor={NIGHT.teal} stopOpacity={0} />
        </radialGradient>
        <radialGradient id={`${id}v`} cx={voiceAt[0]} cy={voiceAt[1]} r={120} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={NIGHT.tealSoft} stopOpacity={0.5} />
          <stop offset="0.4" stopColor={NIGHT.teal} stopOpacity={0.18} />
          <stop offset="1" stopColor={NIGHT.teal} stopOpacity={0} />
        </radialGradient>
        <radialGradient id={`${id}s`} cx={scr[0]} cy={scr[1]} r={170} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={NIGHT.phoneBloom} stopOpacity={0.42} />
          <stop offset="0.35" stopColor={NIGHT.tealSoft} stopOpacity={0.16} />
          <stop offset="1" stopColor={NIGHT.teal} stopOpacity={0} />
        </radialGradient>
      </defs>
      <g transform={camT(camera)}>
        {wash > 0.001 ? <circle cx={lens[0] + 24} cy={lens[1] + 46} r={170} fill={`url(#${id}w)`} opacity={Math.min(1, wash)} /> : null}
        {voice > 0.001 ? <circle cx={voiceAt[0]} cy={voiceAt[1]} r={120} fill={`url(#${id}v)`} opacity={Math.min(1, voice)} /> : null}
        {screen > 0.001 ? <ellipse cx={scr[0]} cy={scr[1]} rx={150} ry={170} fill={`url(#${id}s)`} opacity={Math.min(1.4, screen)} /> : null}
      </g>
    </svg>
  );
};

export type CabinProps = {
  camera: CarCamera;
  pose: RitaPose;
  sec: number;
  spill?: Spill;
  /** Drawn over everything, in rest px under the camera (the tossed phone). */
  props?: React.ReactNode;
  id?: string;
  style?: React.CSSProperties;
};

export const Cabin: React.FC<CabinProps> = ({camera, pose, sec, spill = {}, props, id = 'rsh', style}) => (
  <AbsoluteFill style={style}>
    <CarInterior layer="back" camera={camera} clock={STORY_CLOCK} office={OFFICE} mirrorPulse={missedPulse(sec)} time={sec} />
    <RitaA layer="body" camera={camera} {...pose} />
    <Spills camera={camera} pose={pose} spill={spill} id={`${id}sp`} />
    <CarInterior layer="front" camera={camera} pad={NOTES} pen={false} time={sec} />
    <RitaA layer="front" camera={camera} {...pose} />
    {props ? (
      <svg width={1080} height={1920} viewBox="0 0 1080 1920" style={{position: 'absolute', inset: 0, pointerEvents: 'none'}}>
        <g transform={camT(camera)}>{props}</g>
      </svg>
    ) : null}
  </AbsoluteFill>
);
