// src/nudges.ts
// Video call check: only speak up when a habit has lasted a while, one reminder at a time.
import type { CueId, Reading } from './cues';

export type NudgeKey =
  | 'good'
  | 'noFace'
  | 'lookingAway'
  | 'lookingDown'
  | 'leaningBack'
  | 'tense'
  | 'handToFace'
  | 'fidgeting';

interface Rule {
  key: Exclude<NudgeKey, 'good'>;
  after: number; // seconds the condition must hold
  test: (r: Reading, active: Set<CueId>) => boolean;
}

// In priority order: the first rule that has held long enough wins.
const RULES: Rule[] = [
  { key: 'noFace', after: 3, test: (r) => !r.faceVisible },
  { key: 'lookingAway', after: 5, test: (_, a) => a.has('lookingAway') },
  { key: 'lookingDown', after: 8, test: (_, a) => a.has('lookingDown') },
  { key: 'leaningBack', after: 10, test: (_, a) => a.has('leaningBack') },
  { key: 'tense', after: 8, test: (r) => r.tension > 0.55 },
  { key: 'handToFace', after: 6, test: (_, a) => a.has('handToFace') },
  { key: 'fidgeting', after: 8, test: (_, a) => a.has('fidgeting') },
];

const MIN_SHOW_MS = 2500; // keep a reminder up long enough to read

export class Nudger {
  private since = new Map<Rule['key'], number>();
  private current: NudgeKey = 'good';
  private shownAt = 0;

  update(r: Reading, t: number): NudgeKey {
    const active = new Set(r.cues.map((c) => c.id));
    let next: NudgeKey = 'good';
    for (const rule of RULES) {
      if (rule.test(r, active)) {
        if (!this.since.has(rule.key)) this.since.set(rule.key, t);
        if (next === 'good' && t - this.since.get(rule.key)! >= rule.after * 1000) next = rule.key;
      } else {
        this.since.delete(rule.key);
      }
    }
    if (next !== this.current) {
      const holding = this.current !== 'good' && next === 'good' && t - this.shownAt < MIN_SHOW_MS;
      if (!holding) {
        this.current = next;
        this.shownAt = t;
      }
    }
    return this.current;
  }
}
