// src/session.ts
// Counts what happened during a practice run, in memory only, for the summary screen.
// Nothing here is saved; it is dropped when the next session starts or the page closes.
import { CUE_IDS, isFaceCue, pickHeadline, type CueId, type HeadlineKey, type Reading } from './cues';
import { verdict, type Mode } from './modes';

interface CueStat {
  seconds: number;
  count: number; // separate times it appeared
}

export interface SummaryItem {
  id: CueId;
  share: number; // 0..1 of the time you were in view (face cues: of the time your face was visible)
  count: number;
}

export interface Summary {
  seconds: number;
  headline: HeadlineKey;
  openness: number;
  engagement: number;
  tension: number;
  wentWell: SummaryItem[];
  workOn: SummaryItem[];
  short: boolean;
}

const MAX_ITEMS = 4;

export class Session {
  private seconds = 0;
  private present = 0;
  private faceTime = 0;
  private stats = new Map<CueId, CueStat>(CUE_IDS.map((id) => [id, { seconds: 0, count: 0 }]));
  private prev = new Set<CueId>();
  private sums = { openness: 0, engagement: 0, tension: 0 };
  private mode: Mode;

  constructor(mode: Mode) {
    this.mode = mode;
  }

  update(r: Reading, dt: number) {
    this.seconds += dt;
    if (!r.present) {
      this.prev.clear();
      return;
    }
    this.present += dt;
    if (r.faceVisible) this.faceTime += dt;
    this.sums.openness += r.openness * dt;
    this.sums.engagement += r.engagement * dt;
    this.sums.tension += r.tension * dt;

    const now = new Set<CueId>();
    for (const c of r.cues) {
      const s = this.stats.get(c.id)!;
      s.seconds += dt;
      if (!this.prev.has(c.id)) s.count++;
      now.add(c.id);
    }
    this.prev = now;
  }

  get elapsed() {
    return this.seconds;
  }

  summary(): Summary {
    const avg = (v: number) => (this.present > 0 ? v / this.present : 0);
    const openness = avg(this.sums.openness);
    const engagement = avg(this.sums.engagement);
    const tension = avg(this.sums.tension);

    const items: (SummaryItem & { v: ReturnType<typeof verdict> })[] = [];
    for (const [id, s] of this.stats) {
      if (!s.seconds) continue;
      const base = isFaceCue(id) ? this.faceTime : this.present;
      if (base <= 0) continue;
      items.push({ id, share: Math.min(1, s.seconds / base), count: s.count, v: verdict(this.mode, id, 'neutral') });
    }
    const byShare = (a: SummaryItem, b: SummaryItem) => b.share - a.share;

    return {
      seconds: this.seconds,
      headline: pickHeadline(this.present > 0, openness, engagement, tension, false),
      openness,
      engagement,
      tension,
      wentWell: items.filter((i) => i.v === 'good' && i.share >= 0.15).sort(byShare).slice(0, MAX_ITEMS),
      workOn: items
        .filter((i) => i.v === 'work' && (i.share >= 0.05 || i.count >= 3))
        .sort(byShare)
        .slice(0, MAX_ITEMS),
      short: this.seconds < 30,
    };
  }
}
