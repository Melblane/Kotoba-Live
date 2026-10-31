/**
 * Text-level segmentation for Japanese subtitles.
 *
 * Splits at sentence ends first, then at clause boundaries (、 and a short list of
 * conjunctions) only when a sentence is too long to read at a glance. Breaks are only ever
 * made at word boundaries, and a long phrase is kept whole rather than cut in the middle.
 */

export interface SplitLimits {
  /** Longest piece we try to produce, in characters. */
  maxChars: number;
  /** Pieces shorter than this are merged into a neighbour. */
  minChars: number;
}

export const DEFAULT_LIMITS: SplitLimits = { maxChars: 34, minChars: 6 };

const SENTENCE_END = /[。！？!?‥…]+[」』）)”"’']*/gu;

/**
 * Standalone tokens after which a clause can safely end. "から" is deliberately absent:
 * it is also the particle meaning "from", and cutting after it separates a phrase.
 */
const WEAK_BREAK_TOKENS = new Set(['ので', 'けど', 'けれど', 'けれども', 'のに', 'ながら', 'ですが', 'ますが', 'ましたが', 'だが']);

let cachedSegmenter: Intl.Segmenter | null | undefined;
function wordSegmenter(): Intl.Segmenter | null {
  if (cachedSegmenter === undefined) {
    try {
      cachedSegmenter = new Intl.Segmenter('ja', { granularity: 'word' });
    } catch {
      cachedSegmenter = null;
    }
  }
  return cachedSegmenter;
}

const tokensOf = (text: string): string[] | null => {
  const seg = wordSegmenter();
  return seg ? Array.from(seg.segment(text), (s) => s.segment) : null;
};

function splitSentences(text: string): string[] {
  const out: string[] = [];
  let last = 0;
  for (const m of text.matchAll(SENTENCE_END)) {
    const end = (m.index ?? 0) + m[0].length;
    out.push(text.slice(last, end));
    last = end;
  }
  if (last < text.length) out.push(text.slice(last));
  return out.map((s) => s.trim()).filter(Boolean);
}

const splitClauses = (sentence: string): string[] =>
  sentence.split(/(?<=[、，,])/u).map((c) => c.trim()).filter(Boolean);

/** Breaks a long comma-less clause after a standalone conjunction token, if one exists. */
function splitAtConjunctions(clause: string, limits: SplitLimits): string[] {
  if (clause.length <= limits.maxChars) return [clause];
  const tokens = tokensOf(clause);
  if (!tokens) return [clause];
  const parts: string[] = [];
  let cur = '';
  tokens.forEach((token, i) => {
    cur += token;
    const remaining = tokens.slice(i + 1).join('').length;
    if (WEAK_BREAK_TOKENS.has(token) && cur.length >= limits.minChars * 2 && remaining >= limits.minChars) {
      parts.push(cur);
      cur = '';
    }
  });
  if (cur) parts.push(cur);
  return parts;
}

function packClauses(clauses: string[], max: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const c of clauses) {
    if (cur && cur.length + c.length > max) {
      out.push(cur);
      cur = c;
    } else {
      cur += c;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Last resort for a very long run with no punctuation or conjunction: split near the middle at a word boundary. */
function splitHard(piece: string, hardMax: number): string[] {
  if (piece.length <= hardMax) return [piece];
  const tokens = tokensOf(piece);
  if (!tokens || tokens.length < 2) return [piece];
  let acc = 0;
  let best = 1;
  let bestDist = Infinity;
  for (let i = 0; i < tokens.length - 1; i++) {
    acc += tokens[i].length;
    const dist = Math.abs(acc - piece.length / 2);
    if (dist < bestDist) {
      bestDist = dist;
      best = i + 1;
    }
  }
  const left = tokens.slice(0, best).join('');
  const right = tokens.slice(best).join('');
  return [...splitHard(left, hardMax), ...splitHard(right, hardMax)];
}

function mergeTiny(pieces: string[], limits: SplitLimits): string[] {
  const cap = limits.maxChars * 1.4;
  const out: string[] = [];
  for (const p of pieces) {
    const prev = out[out.length - 1];
    if (prev !== undefined && p.length < limits.minChars && prev.length + p.length <= cap) out[out.length - 1] = prev + p;
    else out.push(p);
  }
  if (out.length > 1 && out[0].length < limits.minChars && out[0].length + out[1].length <= cap) {
    out[1] = out[0] + out[1];
    out.shift();
  }
  return out;
}

export function splitJapanese(text: string, limits: SplitLimits = DEFAULT_LIMITS): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const pieces: string[] = [];
  for (const sentence of splitSentences(clean)) {
    if (sentence.length <= limits.maxChars) {
      pieces.push(sentence);
      continue;
    }
    const clauses = splitClauses(sentence).flatMap((c) => splitAtConjunctions(c, limits));
    pieces.push(...packClauses(clauses, limits.maxChars).flatMap((p) => splitHard(p, Math.round(limits.maxChars * 1.6))));
  }
  return mergeTiny(pieces, limits);
}

/** Spreads a segment's time span over its pieces in proportion to their length. */
export function allocateTimes(pieces: string[], startMs: number, endMs: number): Array<{ startMs: number; endMs: number }> {
  const total = pieces.reduce((n, p) => n + p.length, 0) || 1;
  const span = Math.max(0, endMs - startMs);
  let acc = 0;
  return pieces.map((p) => {
    const s = startMs + Math.round((acc / total) * span);
    acc += p.length;
    return { startMs: s, endMs: startMs + Math.round((acc / total) * span) };
  });
}

// ---- overlap removal ----------------------------------------------------------------------

const skippable = (ch: string) => /[\s\p{P}\p{S}]/u.test(ch);

function indexed(s: string): { chars: string[]; at: number[] } {
  const chars: string[] = [];
  const at: number[] = [];
  let i = 0;
  for (const ch of s) {
    if (!skippable(ch)) {
      chars.push(ch.toLowerCase());
      at.push(i);
    }
    i += ch.length;
  }
  return { chars, at };
}

function distance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/**
 * When a long stretch of speech is cut without a pause, the next audio chunk deliberately
 * starts a little before the cut so no word is clipped. The recognizer then repeats those few
 * characters. This removes that repeated start from `next`, given the end of `prev`.
 * Only ever applied to segments known to carry overlap, and limited to `maxChars`.
 */
export function trimOverlap(prev: string, next: string, maxChars: number): string {
  const a = indexed(prev).chars;
  const b = indexed(next);
  const limit = Math.min(maxChars, a.length, b.chars.length);
  for (let k = limit; k >= 2; k--) {
    const tail = a.slice(-k).join('');
    const head = b.chars.slice(0, k).join('');
    const close = tail === head || (k >= 5 && distance(tail, head) <= 1);
    if (!close) continue;
    const cut = k < b.chars.length ? b.at[k] : next.length;
    return next.slice(cut).replace(/^[\s、，,。.]+/u, '').trim();
  }
  return next;
}

export function commonPrefixLength(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  let n = 0;
  let units = 0;
  while (n < x.length && n < y.length && x[n] === y[n]) {
    units += x[n].length;
    n++;
  }
  return units;
}
