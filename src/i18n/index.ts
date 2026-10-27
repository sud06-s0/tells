// src/i18n/index.ts
// Tiny translation layer: t(key), number formatting, and [data-i18n] attributes in the HTML.
import { bn } from './bn';
import { en, type Key, type Strings } from './en';
import { hi } from './hi';

export type { Key } from './en';
export type Lang = 'en' | 'bn' | 'hi';

export const LANGS: { id: Lang; name: string }[] = [
  { id: 'en', name: 'English' },
  { id: 'bn', name: 'বাংলা' },
  { id: 'hi', name: 'हिन्दी' },
];

const TABLES: Record<Lang, Strings> = { en, bn, hi };
const LOCALES: Record<Lang, string> = { en: 'en-IN', bn: 'bn-IN', hi: 'hi-IN' };
const STORE_KEY = 'tells.lang';

const isLang = (v: unknown): v is Lang => v === 'en' || v === 'bn' || v === 'hi';

function detect(): Lang {
  const fromUrl = new URLSearchParams(location.search).get('lang');
  if (isLang(fromUrl)) return fromUrl;
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (isLang(saved)) return saved;
  } catch {
    /* storage blocked */
  }
  for (const l of navigator.languages ?? [navigator.language]) {
    const base = l.toLowerCase().split('-')[0];
    if (isLang(base)) return base;
  }
  return 'en';
}

let lang: Lang = detect();
const listeners = new Set<() => void>();

export const getLang = () => lang;

export function isKey(k: string): k is Key {
  return k in en;
}

/** Looks up a string and fills {placeholders}. Falls back to English if a key is missing. */
export function t(key: Key, vars?: Record<string, string | number>) {
  let s = TABLES[lang][key] ?? en[key];
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

/** Numbers in the current language (Bengali uses Bengali digits). */
export function num(n: number, opts?: Intl.NumberFormatOptions) {
  return new Intl.NumberFormat(LOCALES[lang], opts).format(n);
}

/** Fills every [data-i18n] / [data-i18n-aria] element under root. */
export function applyI18n(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const key = el.dataset.i18n!;
    if (isKey(key)) el.textContent = t(key);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach((el) => {
    const key = el.dataset.i18nAria!;
    if (isKey(key)) el.setAttribute('aria-label', t(key));
  });
  renderSwitchers(root);
}

export function setLang(next: Lang) {
  if (next === lang) return;
  lang = next;
  try {
    localStorage.setItem(STORE_KEY, next);
  } catch {
    /* storage blocked: the choice lasts for this visit only */
  }
  document.documentElement.lang = next;
  applyI18n();
  listeners.forEach((fn) => fn());
}

export function onLangChange(fn: () => void) {
  listeners.add(fn);
}

/** Any element with [data-lang-switch] becomes a three-way language picker. */
function renderSwitchers(root: ParentNode) {
  root.querySelectorAll<HTMLElement>('[data-lang-switch]').forEach((box) => {
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', t('lang.label'));
    if (!box.childElementCount) {
      for (const { id, name } of LANGS) {
        const b = document.createElement('button');
        b.type = 'button';
        b.lang = id;
        b.textContent = name;
        b.dataset.lang = id;
        b.className =
          'rounded-full px-3 py-1.5 text-sm font-semibold text-fog transition hover:text-chalk focus-visible:outline-2 focus-visible:outline-seaglass aria-pressed:bg-chalk aria-pressed:text-dusk-900';
        b.addEventListener('click', () => setLang(id));
        box.appendChild(b);
      }
    }
    box.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
  });
}

document.documentElement.lang = lang;
