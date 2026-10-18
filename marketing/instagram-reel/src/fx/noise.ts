// Deterministic noise helpers for the fx (no Math.random: lattice values come
// from remotion's seeded random()).
import {random} from 'remotion';
import {FPS} from '../timeline.ts';

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** 1D gradient (Perlin) noise in about -1..1, smooth, deterministic per seed. */
export const perlin1 = (seed: string | number, x: number): number => {
  const i = Math.floor(x);
  const t = x - i;
  const g0 = random(`${seed}:${i}`) * 2 - 1;
  const g1 = random(`${seed}:${i + 1}`) * 2 - 1;
  const v = g0 * t + (g1 * (t - 1) - g0 * t) * fade(t);
  return Math.max(-1, Math.min(1, v * 2));
};

/** Two-octave Perlin, about -1..1. */
export const fbm1 = (seed: string | number, x: number): number => (perlin1(seed, x) + 0.5 * perlin1(`${seed}~`, x * 2.17 + 3.1)) / 1.25;

export type Handheld = {x: number; y: number; rot: number};

/**
 * Handheld camera drift: Perlin noise at `hz` (board: 0.6 Hz) with `amp` px of
 * travel (2–3 px for Rita, 1 px for Gus's calmer hands), plus a hair of roll.
 */
export const handheld = (frame: number, amp = 2.5, hz = 0.6, seed = 'hand'): Handheld => {
  const t = (frame / FPS) * hz;
  return {
    x: fbm1(`${seed}x`, t) * amp,
    y: fbm1(`${seed}y`, t + 17.3) * amp,
    rot: fbm1(`${seed}r`, t * 0.7 + 41.7) * amp * 0.03,
  };
};

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
