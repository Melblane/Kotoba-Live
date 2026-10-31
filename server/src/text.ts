export const normalize = (s: string): string => s.replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();

const OUTRO_HALLUCINATIONS = new Set(
  [
    'ご視聴ありがとうございました',
    'ご視聴ありがとうございます',
    'ご清聴ありがとうございました',
    '最後までご視聴いただきありがとうございました',
    'チャンネル登録お願いします',
    'チャンネル登録をお願いします',
    '字幕視聴ありがとうございました',
  ].map(normalize),
);

/** Whisper invents these phrases over silence, music and noise. */
export function isHallucination(text: string): boolean {
  const n = normalize(text);
  if (!n) return true;
  if (!/[\p{L}\p{N}]/u.test(text)) return true; // only symbols such as ♪
  if (OUTRO_HALLUCINATIONS.has(n)) return true;
  if (/(.{1,8})\1{5,}/u.test(n)) return true; // looping output
  return false;
}

export function cleanTranscript(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function isJapaneseLanguage(lang: string | undefined): boolean {
  if (!lang) return true; // provider did not say, so trust the audio
  const l = lang.toLowerCase();
  return l === 'ja' || l === 'japanese';
}

export interface GlossaryEntry {
  ja: string;
  th: string;
}

export function parseGlossary(raw: string): GlossaryEntry[] {
  const out: GlossaryEntry[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const [ja, th] = line.split(/\s*(?:=>|->|→|=|:|：)\s*/, 2);
    if (ja?.trim() && th?.trim()) out.push({ ja: ja.trim(), th: th.trim() });
  }
  return out.slice(0, 60);
}
