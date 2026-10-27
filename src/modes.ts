// src/modes.ts
// The four ways to use Tells, and how each one treats a cue.
//
// What Tells deliberately does NOT offer: lie detection, attraction or
// "is this person interested in me" modes, scoring job candidates or students,
// or any hidden/background recording. Body language can't reliably answer those
// questions, and judging other people's emotions at work or school is restricted
// in some places (e.g. the EU AI Act).
import type { Facing } from './camera';
import type { CueId, Tone } from './cues';
import { isKey, type Key } from './i18n';

export type ModeId = 'read' | 'interview' | 'presentation' | 'call';
export type Verdict = 'good' | 'work' | 'neutral';

export interface Mode {
  id: ModeId;
  self: boolean; // practising on yourself (tips) vs reading someone else (meanings)
  facing: Facing; // which camera to start with on a phone
  calibrate: number; // seconds spent learning your normal posture first (0 = none)
  posture: 'sit' | 'stand';
  summary: boolean; // show a summary at the end
  nudges: boolean; // short reminders for habits that last too long
  allowPhone: boolean; // can a paired phone be the camera
  phoneOk: boolean; // offered when the app itself is opened on a phone
}

export const MODES: Record<ModeId, Mode> = {
  read: {
    id: 'read',
    self: false,
    facing: 'environment',
    calibrate: 0,
    posture: 'sit',
    summary: false,
    nudges: false,
    allowPhone: true,
    phoneOk: true,
  },
  interview: {
    id: 'interview',
    self: true,
    facing: 'user',
    calibrate: 4,
    posture: 'sit',
    summary: true,
    nudges: false,
    allowPhone: true,
    phoneOk: true,
  },
  presentation: {
    id: 'presentation',
    self: true,
    facing: 'user',
    calibrate: 4,
    posture: 'stand',
    summary: true,
    nudges: false,
    allowPhone: true,
    phoneOk: true,
  },
  call: {
    id: 'call',
    self: true,
    facing: 'user',
    calibrate: 3,
    posture: 'sit',
    summary: true,
    nudges: true,
    allowPhone: false, // you're on the call at your computer, so use its webcam
    phoneOk: false, // phones can't share the camera with a call app
  },
};

export const MODE_ORDER: ModeId[] = ['read', 'interview', 'presentation', 'call'];

export const isModeId = (v: unknown): v is ModeId => typeof v === 'string' && v in MODES;

// How a cue counts when it's you: something going well, or something to work on.
const SELF_VERDICT: Record<CueId, Verdict> = {
  armsCrossed: 'work',
  handsOnHips: 'work',
  handToFace: 'work',
  gesturing: 'good',
  fidgeting: 'work',
  handsHidden: 'work',
  leaningIn: 'good',
  leaningBack: 'work',
  turnedAway: 'work',
  shouldersRaised: 'work',
  smiling: 'good',
  browsLowered: 'work',
  browsRaised: 'neutral',
  lipsPressed: 'work',
  eyeContact: 'good',
  lookingAway: 'work',
  lookingDown: 'work',
  headTilt: 'good',
  nodding: 'good',
  headShake: 'work',
  blinking: 'work',
};

const READ_VERDICT: Record<Tone, Verdict> = { open: 'good', closed: 'work', neutral: 'neutral' };

export function verdict(mode: Mode, id: CueId, tone: Tone): Verdict {
  return mode.self ? SELF_VERDICT[id] : READ_VERDICT[tone];
}

/** Text under a cue: what it can mean (reading someone) or a tip (practising). */
export function cueTextKey(mode: Mode, id: CueId): Key {
  if (!mode.self) return `cue.${id}.meaning` as Key;
  const specific = `tip.${mode.id}.${id}`;
  return isKey(specific) ? specific : (`tip.${id}` as Key);
}

export const cueLabelKey = (id: CueId) => `cue.${id}.label` as Key;
