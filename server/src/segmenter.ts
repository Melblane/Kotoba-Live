import { concatPcm, rmsOf, Vad } from './audio.js';
import { SAMPLE_RATE } from './protocol.js';

export type Latency = 'fast' | 'balanced' | 'accurate';

export interface Profile {
  /** Pause that ends a segment once it has been going for a while (3 s or more). */
  pauseMinMs: number;
  /** Pause needed to end a very short segment, so brief hesitations don't split a phrase. */
  pauseMaxMs: number;
  /** A segment is cut after this much speech even without a pause. */
  maxSegmentMs: number;
  /** How often the current segment is re-transcribed to refresh the live text. */
  interimEveryMs: number;
}

export const PROFILES: Record<Latency, Profile> = {
  fast: { pauseMinMs: 250, pauseMaxMs: 400, maxSegmentMs: 4_000, interimEveryMs: 700 },
  balanced: { pauseMinMs: 300, pauseMaxMs: 500, maxSegmentMs: 5_000, interimEveryMs: 1_000 },
  accurate: { pauseMinMs: 350, pauseMaxMs: 500, maxSegmentMs: 6_000, interimEveryMs: 1_500 },
};

/** Audio replayed at the start of a segment that continues unbroken speech. */
export const OVERLAP_MS = 400;
/** Audio kept from before speech starts so the first syllable isn't clipped. */
export const PREROLL_MS = 300;
/** Segments with less voiced audio than this never reach the recognizer. */
export const MIN_SPEECH_MS = 300;
const INTERIM_MIN_SPEECH_MS = 500;
const CUT_WINDOW_MS = 1_500;

export interface Segment {
  id: string;
  seq: number;
  /** Time of speech onset on the audio clock (excludes pre-roll and overlap). */
  startMs: number;
  endMs: number;
  /** Audio to transcribe: overlap + own audio. */
  pcm: Int16Array;
  speechMs: number;
  overlapMs: number;
  /** True when this segment follows an unbroken-speech cut and starts with overlap audio. */
  continuation: boolean;
  /** True when this segment was ended by the length limit rather than a pause. */
  forced: boolean;
}

export interface InterimSnapshot {
  id: string;
  seq: number;
  startMs: number;
  endMs: number;
  pcm: Int16Array;
  overlapMs: number;
  continuation: boolean;
}

export interface SegmenterHooks {
  profile(): Profile;
  /** Lets the owner skip an interim refresh while the recognizer is busy. */
  canInterim(): boolean;
  onSegment(segment: Segment): void;
  onInterim(snapshot: InterimSnapshot): void;
  onSpeech(speaking: boolean): void;
}

interface Chunk {
  pcm: Int16Array;
  rms: number;
  durMs: number;
  startMs: number;
  speech: boolean;
}

const sum = (chunks: Chunk[], pick: (c: Chunk) => boolean = () => true): number =>
  chunks.reduce((n, c) => (pick(c) ? n + c.durMs : n), 0);

/**
 * Audio buffering and segment boundaries, and nothing else. It does not know about
 * transcription or translation: it turns a PCM stream into segments and interim snapshots.
 */
export class AudioSegmenter {
  private totalMs: number;
  private readonly vad = new Vad();
  private preroll: Chunk[] = [];
  private chunks: Chunk[] = [];
  private overlapCount = 0;
  private overlapMs = 0;
  private continuation = false;
  private inSpeech = false;
  private silenceMs = 0;
  private speechMs = 0;
  private ownMs = 0;
  private lastSpeechEnd = 0;
  private seq = 0;
  private currentId = '';
  private lastInterimAt = 0;

  constructor(private readonly hooks: SegmenterHooks, offsetMs = 0) {
    this.totalMs = offsetMs;
  }

  /** Id of the segment being spoken right now, or null in silence. */
  get activeId(): string | null {
    return this.inSpeech ? this.currentId : null;
  }

  /** Feed 16 kHz mono PCM (any length; the browser sends 100 ms frames). */
  push(pcm: Int16Array): void {
    const durMs = (pcm.length * 1000) / SAMPLE_RATE;
    const rms = rmsOf(pcm);
    const speech = this.vad.isSpeech(rms);
    const chunk: Chunk = { pcm, rms, durMs, startMs: this.totalMs, speech };
    this.totalMs += durMs;
    if (speech) this.lastSpeechEnd = this.totalMs;

    if (!this.inSpeech) {
      if (speech) this.begin(chunk);
      else this.keepPreroll(chunk);
      return;
    }

    this.chunks.push(chunk);
    this.ownMs += durMs;
    if (speech) {
      this.silenceMs = 0;
      this.speechMs += durMs;
    } else {
      this.silenceMs += durMs;
    }

    const profile = this.hooks.profile();
    if (this.silenceMs >= this.pauseNeeded(profile)) this.finalize(false);
    else if (this.ownMs >= profile.maxSegmentMs) this.finalize(true);
    else this.maybeInterim(profile);
  }

  /** Ends the segment in progress (used when the user stops listening). */
  flush(): void {
    if (this.inSpeech && this.chunks.length) this.finalize(false);
  }

  /** Short segments need a longer pause to end; long ones end on a brief breath. */
  private pauseNeeded(p: Profile): number {
    const spoken = this.ownMs - this.silenceMs;
    if (spoken <= 800) return p.pauseMaxMs;
    if (spoken >= 3000) return p.pauseMinMs;
    return p.pauseMaxMs - ((spoken - 800) / 2200) * (p.pauseMaxMs - p.pauseMinMs);
  }

  private keepPreroll(chunk: Chunk): void {
    this.preroll.push(chunk);
    let kept = 0;
    let i = this.preroll.length;
    while (i > 0 && kept < PREROLL_MS) kept += this.preroll[--i].durMs;
    if (i > 0) this.preroll.splice(0, i);
  }

  private begin(first: Chunk): void {
    this.chunks = [...this.preroll, first];
    this.preroll = [];
    this.overlapCount = 0;
    this.overlapMs = 0;
    this.continuation = false;
    this.silenceMs = 0;
    this.speechMs = first.durMs;
    this.ownMs = sum(this.chunks);
    this.currentId = `u${++this.seq}`;
    this.lastInterimAt = this.totalMs;
    this.inSpeech = true;
    this.hooks.onSpeech(true);
  }

  private onset(): number {
    const own = this.chunks.slice(this.overlapCount);
    return (own.find((c) => c.speech) ?? own[0] ?? this.chunks[0]).startMs;
  }

  private maybeInterim(p: Profile): void {
    if (this.speechMs < INTERIM_MIN_SPEECH_MS) return;
    if (this.totalMs - this.lastInterimAt < p.interimEveryMs) return;
    if (!this.hooks.canInterim()) return;
    this.lastInterimAt = this.totalMs;
    this.hooks.onInterim({
      id: this.currentId,
      seq: this.seq,
      startMs: this.onset(),
      endMs: this.totalMs,
      pcm: concatPcm(this.chunks.map((c) => c.pcm)),
      overlapMs: this.overlapMs,
      continuation: this.continuation,
    });
  }

  /** Quietest chunk in the last stretch of the segment, so a forced cut lands between words. */
  private cutIndex(): number {
    const from = Math.max(this.ownMs - CUT_WINDOW_MS, CUT_WINDOW_MS);
    let elapsed = 0;
    let best = -1;
    let bestRms = Infinity;
    for (let i = this.overlapCount; i < this.chunks.length; i++) {
      elapsed += this.chunks[i].durMs;
      if (elapsed >= from && this.chunks[i].rms <= bestRms) {
        best = i;
        bestRms = this.chunks[i].rms;
      }
    }
    return best < 0 ? this.chunks.length - 1 : best;
  }

  private finalize(forced: boolean): void {
    const all = this.chunks;
    if (all.length === 0) {
      this.reset();
      return;
    }
    const cut = forced ? this.cutIndex() : all.length - 1;
    const head = all.slice(0, cut + 1);
    const tail = all.slice(cut + 1);
    const own = head.slice(this.overlapCount);
    const last = head[head.length - 1];
    const clockEnd = last.startMs + last.durMs;

    const segment: Segment = {
      id: this.currentId,
      seq: this.seq,
      startMs: this.onset(),
      endMs: forced ? clockEnd : Math.min(clockEnd, this.lastSpeechEnd + 200),
      pcm: concatPcm(head.map((c) => c.pcm)),
      speechMs: sum(own, (c) => c.speech),
      overlapMs: this.overlapMs,
      continuation: this.continuation,
      forced,
    };

    if (forced) {
      // Speech goes on: the next segment replays the last bit of this one, then carries on.
      const overlap: Chunk[] = [];
      let got = 0;
      for (let i = head.length - 1; i >= 0 && got < OVERLAP_MS; i--) {
        overlap.unshift(head[i]);
        got += head[i].durMs;
      }
      this.chunks = [...overlap, ...tail];
      this.overlapCount = overlap.length;
      this.overlapMs = got;
      this.continuation = true;
      this.ownMs = sum(tail);
      this.speechMs = sum(tail, (c) => c.speech);
      let trailing = 0;
      for (let i = tail.length - 1; i >= 0 && !tail[i].speech; i--) trailing += tail[i].durMs;
      this.silenceMs = trailing;
      this.currentId = `u${++this.seq}`;
      this.lastInterimAt = this.totalMs;
    } else {
      this.reset();
    }
    this.hooks.onSegment(segment);
  }

  private reset(): void {
    const wasSpeaking = this.inSpeech;
    this.chunks = [];
    this.preroll = [];
    this.overlapCount = 0;
    this.overlapMs = 0;
    this.continuation = false;
    this.silenceMs = 0;
    this.speechMs = 0;
    this.ownMs = 0;
    this.inSpeech = false;
    if (wasSpeaking) this.hooks.onSpeech(false);
  }
}
