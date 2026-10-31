import { useCallback, useEffect, useState } from 'react';
import type { Settings } from '@/types';

const KEY = 'kotoba-live:settings:v1';

export const DEFAULT_SETTINGS: Settings = {
  sourceLang: 'ja',
  displayMode: 'both',
  overlayEnabled: false,
  fontSize: 40,
  textColor: '#ffffff',
  bgOpacity: 55,
  position: 'bottom',
  showPartials: true,
  autoScroll: true,
  latency: 'balanced',
  glossary: '',
  accessToken: '',
  overlayDuration: 1,
  overlayLines: 4,
  keepLonger: false,
  draftTranslation: false,
};

const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
const num = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const text = (v: unknown, max: number, fallback: string): string => (typeof v === 'string' ? v.slice(0, max) : fallback);

/** Never trust stored data: validate every field and fall back to defaults. */
export function sanitizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  return {
    sourceLang: oneOf(r.sourceLang, ['ja', 'auto'], d.sourceLang),
    displayMode: oneOf(r.displayMode, ['thai', 'both', 'japanese'], d.displayMode),
    overlayEnabled: bool(r.overlayEnabled, d.overlayEnabled),
    fontSize: num(r.fontSize, 20, 72, d.fontSize),
    textColor: typeof r.textColor === 'string' && /^#[0-9a-f]{6}$/i.test(r.textColor) ? r.textColor : d.textColor,
    bgOpacity: num(r.bgOpacity, 0, 100, d.bgOpacity),
    position: oneOf(r.position, ['top', 'center', 'bottom'], d.position),
    showPartials: bool(r.showPartials, d.showPartials),
    autoScroll: bool(r.autoScroll, d.autoScroll),
    latency: oneOf(r.latency, ['fast', 'balanced', 'accurate'], d.latency),
    glossary: text(r.glossary, 2000, d.glossary),
    accessToken: text(r.accessToken, 256, d.accessToken),
    overlayDuration: num(r.overlayDuration, 0.5, 3, d.overlayDuration),
    overlayLines: Math.round(num(r.overlayLines, 1, 6, d.overlayLines)),
    keepLonger: bool(r.keepLonger, d.keepLonger),
    draftTranslation: bool(r.draftTranslation, d.draftTranslation),
  };
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? sanitizeSettings(JSON.parse(raw)) : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(load);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
      /* storage may be unavailable (private mode); preferences then last for this session only */
    }
  }, [settings]);

  const update = useCallback((patch: Partial<Settings>) => setSettings((s) => sanitizeSettings({ ...s, ...patch })), []);
  const reset = useCallback(() => setSettings((s) => ({ ...DEFAULT_SETTINGS, accessToken: s.accessToken })), []);
  return { settings, update, reset };
}
