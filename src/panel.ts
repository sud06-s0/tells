// src/panel.ts
// Renders a Reading into the side panel / bottom sheet, in the current language and mode.
import type { Cue, CueId, Reading } from './cues';
import { getLang, t, type Key } from './i18n';
import { cueLabelKey, cueTextKey, verdict, type Mode, type Verdict } from './modes';
import type { NudgeKey } from './nudges';

const DOT: Record<Verdict, string> = {
  good: 'bg-seaglass',
  work: 'bg-amber',
  neutral: 'bg-chalk/50',
};
const BAR: Record<Verdict, string> = {
  good: 'bg-seaglass',
  work: 'bg-amber',
  neutral: 'bg-chalk/70',
};

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** "arms crossed and lips pressed" style list of cue names for the explanation line. */
function detailLine(ids: CueId[]) {
  const names = ids.map((id) => {
    const label = t(cueLabelKey(id));
    return getLang() === 'en' ? label.toLowerCase() : label;
  });
  if (!names.length) return t('live.detailNone');
  if (names.length === 1) return t('live.detailOne', { a: names[0] });
  return t('live.detailTwo', { a: names[0], b: names[1] });
}

export class Panel {
  private headline = el('headline');
  private detail = el('detail');
  private hint = el('hint');
  private list = el<HTMLUListElement>('cues');
  private empty = el('cues-empty');
  private meters = {
    openness: el('meter-openness'),
    engagement: el('meter-engagement'),
    tension: el('meter-tension'),
  };
  private items = new Map<CueId, { li: HTMLLIElement; bar: HTMLElement }>();
  private lastRender = 0;
  private lastHeadline = '';
  private mode: Mode | null = null;

  setMode(mode: Mode) {
    this.mode = mode;
    this.reset();
  }

  /** Shown while calibrating, before any reading. */
  showMessage(title: string, body: string) {
    this.headline.textContent = title;
    this.headline.dataset.nudge = 'false';
    this.lastHeadline = '';
    this.detail.textContent = body;
    this.hint.hidden = true;
  }

  render(r: Reading, nudge: NudgeKey | null) {
    const mode = this.mode;
    if (!mode) return;
    const now = performance.now();
    if (now - this.lastRender < 120) return; // ~8 updates a second is plenty to read
    this.lastRender = now;

    const audience = mode.self ? 'self' : 'read';
    const headKey = (nudge ? `nudge.${nudge}` : `head.${audience}.${r.headline}`) as Key;
    // Letterforms soften when open and stiffen under tension. Set only when the headline
    // changes, so the words stay still while they're on screen.
    if (headKey !== this.lastHeadline) {
      this.lastHeadline = headKey;
      this.headline.textContent = t(headKey);
      this.headline.dataset.nudge = String(!!nudge && nudge !== 'good');
      const step = (v: number) => Math.round(v * 4) / 4;
      const casual = r.present ? step(r.openness) : 0.5;
      const weight = 560 + (r.present ? step(r.tension) : 0) * 240;
      this.headline.style.fontVariationSettings = `"CASL" ${casual}, "wght" ${weight}, "slnt" ${-casual * 9}`;
    }

    const detail = r.present ? detailLine(r.top) : t('live.detailIdle');
    if (this.detail.textContent !== detail) this.detail.textContent = detail;
    const hint = r.hint ? t(`hint.${audience}.${r.hint}` as Key) : '';
    if (this.hint.textContent !== hint) this.hint.textContent = hint;
    this.hint.hidden = !hint;

    for (const [key, node] of Object.entries(this.meters)) {
      const value = Math.round((r.present ? r[key as keyof typeof this.meters] : 0) * 100);
      (node.firstElementChild as HTMLElement).style.width = `${value}%`;
      node.setAttribute('aria-valuenow', String(value));
    }

    this.renderCues(r.present ? r.cues : [], mode);
    const emptyText = t(mode.self ? 'live.noCuesSelf' : 'live.noCues');
    if (this.empty.textContent !== emptyText) this.empty.textContent = emptyText;
    this.empty.hidden = !r.present || r.cues.length > 0;
  }

  /** Clears everything; the next render rebuilds it (used for new sessions and language changes). */
  reset() {
    this.items.forEach(({ li }) => li.remove());
    this.items.clear();
    this.lastRender = 0;
    this.lastHeadline = '';
  }

  private renderCues(cues: Cue[], mode: Mode) {
    const keep = new Set(cues.map((c) => c.id));
    for (const [id, { li }] of this.items) {
      if (!keep.has(id)) {
        li.remove();
        this.items.delete(id);
      }
    }
    for (const cue of cues) {
      let item = this.items.get(cue.id);
      if (!item) {
        item = this.createItem(cue, mode);
        this.list.appendChild(item.li); // new cues join at the bottom; existing rows never move
      }
      item.bar.style.width = `${Math.round(cue.strength * 100)}%`;
    }
  }

  private createItem(cue: Cue, mode: Mode) {
    const v = verdict(mode, cue.id, cue.tone);
    const li = document.createElement('li');
    li.className = 'cue-enter grid grid-cols-[auto_1fr_auto] items-baseline gap-x-3 gap-y-1 py-3';

    const dot = document.createElement('span');
    dot.className = `size-2 translate-y-[-1px] rounded-full ${DOT[v]}`;
    dot.setAttribute('aria-hidden', 'true');

    const label = document.createElement('span');
    label.className = 'font-semibold text-chalk';
    label.textContent = t(cueLabelKey(cue.id));

    const track = document.createElement('span');
    track.className = 'h-1.5 w-14 self-center overflow-hidden rounded-full bg-chalk/10';
    track.setAttribute('aria-hidden', 'true');
    const bar = document.createElement('span');
    bar.className = `block h-full rounded-full transition-[width] duration-300 ${BAR[v]}`;
    track.appendChild(bar);

    const text = document.createElement('span');
    text.className = 'col-span-2 col-start-2 text-sm leading-snug text-fog';
    text.textContent = t(cueTextKey(mode, cue.id));

    li.append(dot, label, track, text);
    const item = { li, bar };
    this.items.set(cue.id, item);
    return item;
  }
}
