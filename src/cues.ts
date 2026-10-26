// src/cues.ts
// Turns pose + face landmarks into body-language cues and an overall read.
// Everything here is in-memory arithmetic over the last few seconds; nothing is stored.
import type { FaceLandmarkerResult, PoseLandmarkerResult } from '@mediapipe/tasks-vision';
import {
  Baseline,
  Smooth,
  TimeWindow,
  clamp01,
  countReversals,
  dist,
  headAngles,
  range,
  ramp,
  type Pt,
  type Sample,
} from './geometry';

export type Tone = 'open' | 'closed' | 'neutral';

export type CueId =
  | 'armsCrossed'
  | 'handsOnHips'
  | 'handToFace'
  | 'gesturing'
  | 'fidgeting'
  | 'handsHidden'
  | 'leaningIn'
  | 'leaningBack'
  | 'turnedAway'
  | 'shouldersRaised'
  | 'smiling'
  | 'browsLowered'
  | 'browsRaised'
  | 'lipsPressed'
  | 'eyeContact'
  | 'lookingAway'
  | 'lookingDown'
  | 'headTilt'
  | 'nodding'
  | 'headShake'
  | 'blinking';

interface CueDef {
  label: string;
  meaning: string;
  tone: Tone;
  joints?: number[]; // pose landmark indices to highlight in the overlay
  tau?: number; // smoothing in seconds
}

const DEFS: Record<CueId, CueDef> = {
  armsCrossed: {
    label: 'Arms crossed',
    meaning: 'Often guarded or self-protective. It can also just mean they are cold or comfortable.',
    tone: 'closed',
    joints: [13, 14, 15, 16],
  },
  handsOnHips: {
    label: 'Hands on hips',
    meaning: 'Takes up space. Reads as confident, ready, or impatient.',
    tone: 'neutral',
    joints: [13, 14, 15, 16],
  },
  handToFace: {
    label: 'Hand near face',
    meaning: 'Common when thinking, unsure, or self-soothing.',
    tone: 'neutral',
    joints: [15, 16, 19, 20],
  },
  gesturing: {
    label: 'Gesturing',
    meaning: 'Hands active and visible. Usually engaged and expressive.',
    tone: 'open',
    joints: [15, 16],
  },
  fidgeting: {
    label: 'Fidgeting',
    meaning: 'Small repeated hand movements. Can point to restlessness or nerves.',
    tone: 'closed',
    joints: [15, 16, 17, 18, 19, 20],
    tau: 1,
  },
  handsHidden: {
    label: 'Hands out of sight',
    meaning: 'Hands hidden or behind the body. Gives less away; sometimes reserved.',
    tone: 'closed',
  },
  leaningIn: {
    label: 'Leaning in',
    meaning: 'Moving toward you. Usually interest or engagement.',
    tone: 'open',
  },
  leaningBack: {
    label: 'Leaning back',
    meaning: 'Making distance. Relaxed, or less engaged.',
    tone: 'closed',
  },
  turnedAway: {
    label: 'Body turned away',
    meaning: 'Shoulders angled away from you. Attention may be elsewhere.',
    tone: 'closed',
    joints: [11, 12],
  },
  shouldersRaised: {
    label: 'Shoulders raised',
    meaning: 'Shoulders up toward the ears, compared with their normal. A common sign of tension.',
    tone: 'closed',
    joints: [11, 12],
    tau: 1,
  },
  smiling: {
    label: 'Smiling',
    meaning: 'Warmth or friendliness.',
    tone: 'open',
  },
  browsLowered: {
    label: 'Brows lowered',
    meaning: 'Concentration, confusion, or displeasure.',
    tone: 'neutral',
  },
  browsRaised: {
    label: 'Brows raised',
    meaning: 'Interest, surprise, or worry.',
    tone: 'neutral',
  },
  lipsPressed: {
    label: 'Lips pressed',
    meaning: 'Holding something back, or quiet tension.',
    tone: 'closed',
  },
  eyeContact: {
    label: 'Eye contact',
    meaning: 'Head and eyes toward you. Usually attention.',
    tone: 'open',
  },
  lookingAway: {
    label: 'Looking away',
    meaning: 'Gaze elsewhere. Thinking, distracted, or uncomfortable.',
    tone: 'closed',
  },
  lookingDown: {
    label: 'Looking down',
    meaning: 'Reflecting, reading, or feeling unsure.',
    tone: 'neutral',
  },
  headTilt: {
    label: 'Head tilted',
    meaning: 'Often listening or curious.',
    tone: 'open',
  },
  nodding: {
    label: 'Nodding',
    meaning: 'Agreement, or encouragement to keep going.',
    tone: 'open',
    tau: 0.5,
  },
  headShake: {
    label: 'Shaking head',
    meaning: 'Disagreement or disbelief.',
    tone: 'closed',
    tau: 0.5,
  },
  blinking: {
    label: 'Blinking a lot',
    meaning: 'Higher than usual blink rate. Rises with stress, but also with dry or tired eyes.',
    tone: 'closed',
    tau: 2,
  },
};

const IDS = Object.keys(DEFS) as CueId[];
const SHOW_AT = 0.5;
const HIDE_AT = 0.3;
const HEADLINE_HOLD_MS = 1200;

export interface Cue extends CueDef {
  id: CueId;
  strength: number;
}

export interface Reading {
  present: boolean;
  headline: string;
  detail: string;
  hint: string | null;
  openness: number;
  engagement: number;
  tension: number;
  cues: Cue[];
  highlight: Set<number>;
}

type Raw = Partial<Record<CueId, number>>;
type XY = { x: number; y: number };

export class CueEngine {
  private smooth = new Map<CueId, Smooth>(IDS.map((id) => [id, new Smooth(DEFS[id].tau ?? 0.6)]));
  private active = new Set<CueId>();
  private lastT: number | null = null;
  private lastSeen = -Infinity;

  private wrists = [new TimeWindow<XY>(2000), new TimeWindow<XY>(2000)];
  private pitch = new TimeWindow<number>(1500);
  private yaw = new TimeWindow<number>(1500);
  private neck = new Baseline(12);
  private size = new Baseline(10);

  private blinks: number[] = [];
  private eyesClosed = false;
  private faceSeconds = 0;
  private lastEyeContact = 0;
  private lastAway = 0;

  private openness = new Smooth(1.2, 0.5);
  private engagement = new Smooth(1.2, 0.5);
  private tension = new Smooth(1.2, 0);

  private headline = 'Looking for someone';
  private candidate = this.headline;
  private candidateSince = 0;

  update(pose: PoseLandmarkerResult | null, face: FaceLandmarkerResult | null, t: number, aspect: number): Reading {
    const dt = this.lastT === null ? 1 / 30 : Math.min(0.25, (t - this.lastT) / 1000);
    this.lastT = t;

    const raw: Raw = {};
    const bodyVisible = this.readBody(pose, aspect, t, dt, raw);
    const faceVisible = this.readFace(face, t, dt, raw);
    const present = bodyVisible || faceVisible;

    if (present) this.lastSeen = t;
    else if (t - this.lastSeen > 1000) this.resetMotion();

    // Smooth every cue and apply show/hide hysteresis so the list doesn't flicker.
    for (const id of IDS) {
      const v = this.smooth.get(id)!.push(raw[id] ?? 0, dt);
      if (this.active.has(id)) {
        if (v < HIDE_AT) this.active.delete(id);
      } else if (v > SHOW_AT) this.active.add(id);
    }
    // Listed in the order they appeared (a Set keeps insertion order), so rows
    // don't swap places when two cues have similar strength.
    const cues: Cue[] = [];
    const highlight = new Set<number>();
    for (const id of this.active) {
      cues.push({ id, ...DEFS[id], strength: this.smooth.get(id)!.value });
      if (DEFS[id].tone !== 'open') DEFS[id].joints?.forEach((j) => highlight.add(j));
    }

    const g = (id: CueId) => this.smooth.get(id)!.value;
    if (present) {
      this.openness.push(
        clamp01(
          0.5 +
            0.22 * g('smiling') +
            0.15 * g('gesturing') +
            0.12 * g('eyeContact') +
            0.1 * g('leaningIn') +
            0.1 * g('nodding') +
            0.06 * g('headTilt') +
            0.05 * g('browsRaised') -
            0.32 * g('armsCrossed') -
            0.15 * g('lipsPressed') -
            0.15 * g('turnedAway') -
            0.12 * g('headShake') -
            0.1 * g('leaningBack') -
            0.08 * g('handsHidden') -
            0.08 * g('shouldersRaised'),
        ),
        dt,
      );
      this.engagement.push(
        clamp01(
          0.5 +
            0.25 * g('eyeContact') +
            0.15 * g('nodding') +
            0.12 * g('leaningIn') +
            0.1 * g('gesturing') +
            0.05 * g('headTilt') -
            0.35 * g('lookingAway') -
            0.15 * g('turnedAway') -
            0.12 * g('leaningBack'),
        ),
        dt,
      );
      this.tension.push(
        clamp01(
          0.35 * g('shouldersRaised') +
            0.3 * g('lipsPressed') +
            0.3 * g('fidgeting') +
            0.2 * g('blinking') +
            0.15 * g('handToFace') +
            0.15 * g('browsLowered') +
            0.1 * g('armsCrossed'),
        ),
        dt,
      );
    }

    const openness = this.openness.value;
    const engagement = this.engagement.value;
    const tension = this.tension.value;

    this.updateHeadline(present, openness, engagement, tension, g('handToFace') > SHOW_AT, t);

    let hint: string | null = null;
    if (!present) hint = 'Point the camera at one person, about 1.5 to 3 metres away.';
    else if (!bodyVisible) hint = 'Step back a little so their shoulders and arms are in frame.';
    else if (!faceVisible) hint = 'Their face isn’t visible, so expression cues are paused.';

    return {
      present,
      headline: this.headline,
      detail: describe(present, cues),
      hint,
      openness,
      engagement,
      tension,
      cues,
      highlight,
    };
  }

  // ---- Body -------------------------------------------------------------

  private readBody(pose: PoseLandmarkerResult | null, aspect: number, t: number, dt: number, raw: Raw) {
    const lm = pose?.landmarks[0];
    if (!lm) return false;
    // Scale x by aspect ratio so distances are in true proportions.
    const P = (i: number): Pt => ({ x: lm[i].x * aspect, y: lm[i].y, v: lm[i].visibility ?? 0 });

    const ls = P(11);
    const rs = P(12);
    if (ls.v < 0.5 || rs.v < 0.5) return false;
    const sw = dist(ls, rs); // shoulder width: the unit for everything below
    if (sw < 0.03) return false;

    const mid = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2, v: 1 };
    const lh = P(23);
    const rh = P(24);
    const hipsVisible = lh.v > 0.5 && rh.v > 0.5;
    const torsoBottom = hipsVisible ? (lh.y + rh.y) / 2 : mid.y + 1.6 * sw;
    const lw = P(15);
    const rw = P(16);
    const le = P(13);
    const re = P(14);
    const sideL = Math.sign(ls.x - mid.x) || 1; // which image side the person's left shoulder is on

    // Arms crossed: each wrist has crossed the body midline, at torso height.
    const inTorsoBand = (p: Pt) => p.y > mid.y - 0.15 * sw && p.y < torsoBottom + 0.1 * sw;
    const crossed = (w: Pt, side: number) =>
      w.v > 0.2 && (w.x - mid.x) * side < -0.05 * sw && Math.abs(w.x - mid.x) < 1.1 * sw && inTorsoBand(w);
    raw.armsCrossed = crossed(lw, sideL) && crossed(rw, -sideL) ? 1 : 0;

    if (hipsVisible) {
      // Hands on hips: wrist at the hip with the elbow flared outward.
      const onHip = (w: Pt, hip: Pt, e: Pt, s: Pt) =>
        w.v > 0.3 &&
        dist(w, hip) < 0.5 * sw &&
        (e.x - mid.x) * Math.sign(s.x - mid.x) > Math.abs(s.x - mid.x) + 0.1 * sw;
      const n = Number(onHip(lw, lh, le, ls)) + Number(onHip(rw, rh, re, rs));
      raw.handsOnHips = n === 2 ? 1 : n === 1 ? 0.6 : 0;
      // Only meaningful when the whole torso is in frame.
      raw.handsHidden = lw.v < 0.25 && rw.v < 0.25 ? 1 : 0;
    }

    const nose = P(0);
    if (nose.v > 0.5) {
      const hands = [15, 16, 19, 20].map(P).filter((p) => p.v > 0.3);
      const d = Math.min(Infinity, ...hands.map((p) => dist(p, nose)));
      raw.handToFace = ramp(d, 0.9 * sw, 0.6 * sw);
    }

    // Hand motion over the last 2 s, relative to the shoulders.
    [lw, rw].forEach((w, i) => {
      if (w.v > 0.4) this.wrists[i].push(t, { x: (w.x - mid.x) / sw, y: (w.y - mid.y) / sw });
      else this.wrists[i].prune(t);
    });
    let gesture = 0;
    let fidget = 0;
    for (const win of this.wrists) {
      const s = win.values;
      if (s.length < 10) continue;
      const xs: Sample<number>[] = s.map((a) => ({ t: a.t, v: a.v.x }));
      const ys: Sample<number>[] = s.map((a) => ({ t: a.t, v: a.v.y }));
      const span = Math.max(range(xs), range(ys));
      const turns = countReversals(xs, 0.04) + countReversals(ys, 0.04);
      gesture = Math.max(gesture, ramp(span, 0.35, 0.7));
      if (span < 0.45) fidget = Math.max(fidget, ramp(turns, 3, 7));
    }
    raw.gesturing = gesture;
    raw.fidgeting = fidget;

    // Leaning: depth of shoulders vs hips when hips are visible, else apparent size vs their normal.
    const world = pose?.worldLandmarks[0];
    if (world && hipsVisible) {
      const dz = (world[11].z + world[12].z) / 2 - (world[23].z + world[24].z) / 2;
      raw.leaningIn = ramp(-dz, 0.08, 0.18);
      raw.leaningBack = ramp(dz, 0.06, 0.15);
    } else {
      const ratio = sw / this.size.push(sw, dt);
      raw.leaningIn = ramp(ratio, 1.08, 1.2);
      raw.leaningBack = ramp(ratio, 0.93, 0.82);
    }

    if (world) {
      const a = world[11];
      const b = world[12];
      const angle = (Math.atan2(Math.abs(a.z - b.z), Math.hypot(a.x - b.x, a.y - b.y)) * 180) / Math.PI;
      raw.turnedAway = ramp(angle, 30, 50);
    }

    // Shoulders raised: neck looks shorter than this person's own baseline.
    const lear = P(7);
    const rear = P(8);
    if (lear.v > 0.5 && rear.v > 0.5) {
      const neck = (mid.y - (lear.y + rear.y) / 2) / sw;
      const base = this.neck.value;
      const ratio = base ? neck / base : 1;
      if (ratio > 0.85) this.neck.push(neck, dt); // don't learn from raised moments
      raw.shouldersRaised = ramp(ratio, 0.85, 0.7);
    }

    return true;
  }

  // ---- Face -------------------------------------------------------------

  private readFace(face: FaceLandmarkerResult | null, t: number, dt: number, raw: Raw) {
    if (!face?.faceLandmarks[0]) return false;
    this.faceSeconds += dt;

    const scores = new Map((face.faceBlendshapes[0]?.categories ?? []).map((c) => [c.categoryName, c.score]));
    const b = (n: string) => scores.get(n) ?? 0;
    const pair = (n: string) => (b(`${n}Left`) + b(`${n}Right`)) / 2;

    raw.smiling = ramp(pair('mouthSmile'), 0.3, 0.65);
    raw.browsLowered = ramp(pair('browDown'), 0.25, 0.55);
    raw.browsRaised = ramp(b('browInnerUp'), 0.3, 0.65);
    raw.lipsPressed = ramp(pair('mouthPress'), 0.25, 0.55) * (1 - raw.smiling);

    // Blinks: count closed-eye onsets over the last 30 s.
    const closed = pair('eyeBlink') > 0.5;
    if (closed && !this.eyesClosed) this.blinks.push(t);
    this.eyesClosed = closed;
    while (this.blinks.length && this.blinks[0] < t - 30000) this.blinks.shift();
    if (this.faceSeconds > 15) {
      const perMinute = (this.blinks.length / Math.min(30, this.faceSeconds)) * 60;
      raw.blinking = ramp(perMinute, 28, 40);
    }

    const matrix = face.facialTransformationMatrixes[0]?.data;
    if (matrix) {
      const { pitch, yaw, roll } = headAngles(matrix);
      raw.headTilt = ramp(Math.abs(roll), 9, 18);
      this.pitch.push(t, pitch);
      this.yaw.push(t, yaw);
      raw.nodding = ramp(countReversals(this.pitch.values, 4), 1, 3);
      raw.headShake = ramp(countReversals(this.yaw.values, 6), 1, 3);

      if (closed) {
        // Mid-blink the eye readings are meaningless; hold the last value.
        raw.eyeContact = this.lastEyeContact;
        raw.lookingAway = this.lastAway;
      } else {
        const sideways = Math.max(b('eyeLookOutLeft'), b('eyeLookInLeft'), b('eyeLookOutRight'), b('eyeLookInRight'));
        const headOff = Math.max(ramp(Math.abs(yaw), 12, 28), ramp(Math.abs(pitch), 14, 28));
        const eyesOff = Math.max(ramp(sideways, 0.35, 0.6), ramp(pair('eyeLookUp'), 0.35, 0.6));
        const away = Math.max(headOff, eyesOff);
        raw.eyeContact = this.lastEyeContact = 1 - away;
        raw.lookingAway = this.lastAway = away;
        raw.lookingDown = ramp(pair('eyeLookDown'), 0.45, 0.7);
      }
    }
    return true;
  }

  // ---- Summary ----------------------------------------------------------

  private updateHeadline(present: boolean, open: number, engaged: number, tense: number, thinking: boolean, t: number) {
    let next: string;
    if (!present) next = 'Looking for someone';
    else if (tense > 0.55) next = 'Seems tense';
    else if (open < 0.35 && engaged < 0.45) next = 'Closed off';
    else if (open < 0.38) next = 'Guarded';
    else if (engaged < 0.35) next = 'Distracted';
    else if (thinking) next = 'Thinking it over';
    else if (open > 0.68 && engaged > 0.62) next = 'Open and engaged';
    else if (open > 0.6) next = 'Relaxed and open';
    else if (engaged > 0.65) next = 'Paying attention';
    else next = 'Neutral';

    // Switch instantly when someone appears or leaves; otherwise wait for it to hold.
    const appearing = this.headline === 'Looking for someone' || next === 'Looking for someone';
    if (next !== this.candidate) {
      this.candidate = next;
      this.candidateSince = t;
    }
    if (appearing || t - this.candidateSince > HEADLINE_HOLD_MS) this.headline = this.candidate;
  }

  private resetMotion() {
    this.wrists.forEach((w) => w.clear());
    this.pitch.clear();
    this.yaw.clear();
    this.neck.reset();
    this.size.reset();
    this.blinks = [];
    this.faceSeconds = 0;
  }
}

function describe(present: boolean, cues: Cue[]) {
  if (!present) return 'Nothing is recorded. Each frame is read and thrown away.';
  const telling = cues.filter((c) => c.id !== 'eyeContact').slice(0, 2);
  if (!telling.length) return 'No strong signals right now.';
  const names = telling.map((c) => c.label.toLowerCase());
  return `Mostly from ${names.join(' and ')}.`;
}
