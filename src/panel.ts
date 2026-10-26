// src/panel.ts
// Renders a Reading into the side panel / bottom sheet.
import type { Cue, Reading, Tone } from './cues';

const TONE_DOT: Record<Tone, string> = {
  open: 'bg-seaglass',
  closed: 'bg-amber',
  neutral: 'bg-chalk/50',
};
const TONE_BAR: Record<Tone, string> = {
  open: 'bg-seaglass',
  closed: 'bg-amber',
  neutral: 'bg-chalk/70',
};

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

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
  private items = new Map<string, { li: HTMLLIElement; bar: HTMLElement }>();
  private lastRender = 0;

  render(r: Reading) {
    const now = performance.now();
    if (now - this.lastRender < 120) return; // ~8 updates a second is plenty to read
    this.lastRender = now;

    // The headline's letterforms soften when the person reads open and stiffen under tension.
    // Set once per headline change (not every frame), so the word stays still while it's shown.
    if (this.headline.textContent !== r.headline) {
      this.headline.textContent = r.headline;
      const step = (v: number) => Math.round(v * 4) / 4; // coarse steps, no tiny drifts
      const casual = r.present ? step(r.openness) : 0.5;
      const weight = 560 + (r.present ? step(r.tension) : 0) * 240;
      this.headline.style.fontVariationSettings = `"CASL" ${casual}, "wght" ${weight}, "slnt" ${-casual * 9}`;
    }

    if (this.detail.textContent !== r.detail) this.detail.textContent = r.detail;
    const hint = r.hint ?? '';
    if (this.hint.textContent !== hint) this.hint.textContent = hint;
    this.hint.hidden = !r.hint;

    for (const [key, node] of Object.entries(this.meters)) {
      const value = Math.round((r.present ? r[key as keyof typeof this.meters] : 0) * 100);
      const fill = node.firstElementChild as HTMLElement;
      fill.style.width = `${value}%`;
      node.setAttribute('aria-valuenow', String(value));
    }

    this.renderCues(r.present ? r.cues : []);
    this.empty.hidden = !r.present || r.cues.length > 0;
  }

  reset() {
    this.items.forEach(({ li }) => li.remove());
    this.items.clear();
    this.lastRender = 0;
  }

  private renderCues(cues: Cue[]) {
    const keep = new Set(cues.map((c) => c.id));
    for (const [id, { li }] of this.items) {
      if (!keep.has(id as Cue['id'])) {
        li.remove();
        this.items.delete(id);
      }
    }
    for (const cue of cues) {
      let item = this.items.get(cue.id);
      if (!item) {
        item = this.createItem(cue);
        this.list.appendChild(item.li); // new cues join at the bottom; existing rows never move
      }
      item.bar.style.width = `${Math.round(cue.strength * 100)}%`;
    }
  }

  private createItem(cue: Cue) {
    const li = document.createElement('li');
    li.className = 'cue-enter grid grid-cols-[auto_1fr_auto] items-baseline gap-x-3 gap-y-1 py-3';
    li.innerHTML = `
      <span class="size-2 translate-y-[-1px] rounded-full ${TONE_DOT[cue.tone]}" aria-hidden="true"></span>
      <span class="font-semibold text-chalk">${cue.label}</span>
      <span class="h-1.5 w-14 self-center overflow-hidden rounded-full bg-chalk/10" aria-hidden="true">
        <span class="block h-full rounded-full transition-[width] duration-300 ${TONE_BAR[cue.tone]}"></span>
      </span>
      <span class="col-start-2 col-span-2 text-sm leading-snug text-fog">${cue.meaning}</span>`;
    const bar = li.querySelector<HTMLElement>('span > span')!;
    const item = { li, bar };
    this.items.set(cue.id, item);
    return item;
  }
}
