// src/geometry.ts
// Small math helpers shared by the cue engine.

export interface Pt {
  x: number;
  y: number;
  v: number; // visibility 0..1
}

export const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Maps v from [lo, hi] onto [0, 1]. Works with lo > hi for inverted ramps. */
export const ramp = (v: number, lo: number, hi: number) => clamp01((v - lo) / (hi - lo));

export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** Time-based exponential smoothing; tau is in seconds. */
export class Smooth {
  value: number;
  private tau: number;
  constructor(tau: number, init = 0) {
    this.tau = tau;
    this.value = init;
  }
  push(v: number, dt: number) {
    const a = 1 - Math.exp(-dt / this.tau);
    this.value += a * (v - this.value);
    return this.value;
  }
}

/** A person's own "normal" for a measurement, learned quickly then drifting slowly. */
export class Baseline {
  value: number | null = null;
  private n = 0;
  private tau: number;
  constructor(tau: number) {
    this.tau = tau;
  }
  push(v: number, dt: number) {
    if (this.value === null) {
      this.value = v;
      this.n = 1;
      return v;
    }
    const tau = this.n < 45 ? 0.6 : this.tau;
    this.n++;
    this.value += (1 - Math.exp(-dt / tau)) * (v - this.value);
    return this.value;
  }
  reset() {
    this.value = null;
    this.n = 0;
  }
}

export interface Sample<T> {
  t: number;
  v: T;
}

/** Keeps only samples from the last `span` milliseconds, in memory. */
export class TimeWindow<T> {
  private items: Sample<T>[] = [];
  private span: number;
  constructor(span: number) {
    this.span = span;
  }
  push(t: number, v: T) {
    this.items.push({ t, v });
    this.prune(t);
  }
  prune(t: number) {
    const cut = t - this.span;
    while (this.items.length && this.items[0].t < cut) this.items.shift();
  }
  get values() {
    return this.items;
  }
  clear() {
    this.items = [];
  }
}

/** Counts direction changes larger than minAmp — used for nods, shakes and fidgets. */
export function countReversals(samples: Sample<number>[], minAmp: number) {
  if (!samples.length) return 0;
  let dir = 0;
  let ext = samples[0].v;
  const anchor = samples[0].v;
  let count = 0;
  for (const { v } of samples) {
    if (dir === 0) {
      if (v - anchor > minAmp) {
        dir = 1;
        ext = v;
      } else if (anchor - v > minAmp) {
        dir = -1;
        ext = v;
      }
    } else if (dir === 1) {
      if (v > ext) ext = v;
      else if (ext - v > minAmp) {
        count++;
        dir = -1;
        ext = v;
      }
    } else {
      if (v < ext) ext = v;
      else if (v - ext > minAmp) {
        count++;
        dir = 1;
        ext = v;
      }
    }
  }
  return count;
}

export function range(samples: Sample<number>[]) {
  if (!samples.length) return 0;
  let lo = Infinity;
  let hi = -Infinity;
  for (const { v } of samples) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return hi - lo;
}

const wrap90 = (deg: number) => (deg > 90 ? deg - 180 : deg < -90 ? deg + 180 : deg);

/** Head pitch / yaw / roll in degrees from MediaPipe's column-major 4x4 face matrix. */
export function headAngles(m: number[]) {
  const r = (row: number, col: number) => m[col * 4 + row];
  const toDeg = 180 / Math.PI;
  const pitch = Math.atan2(r(2, 1), r(2, 2)) * toDeg;
  const yaw = Math.asin(-Math.max(-1, Math.min(1, r(2, 0)))) * toDeg;
  const roll = Math.atan2(r(1, 0), r(0, 0)) * toDeg;
  return { pitch: wrap90(pitch), yaw, roll: wrap90(roll) };
}
