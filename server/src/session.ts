import { Lane, pcm16ToWav } from './audio.js';
import { SAMPLE_RATE, type Activity, type ErrorCode, type ServerMessage, type SessionSettings } from './protocol.js';
import { withRetry } from './providers/http.js';
import { ProviderError, type Providers, type SttResult } from './providers/types.js';
import { AudioSegmenter, MIN_SPEECH_MS, PROFILES, type InterimSnapshot, type Segment } from './segmenter.js';
import { allocateTimes, commonPrefixLength, DEFAULT_LIMITS, splitJapanese, trimOverlap } from './sentences.js';
import { cleanTranscript, isHallucination, isJapaneseLanguage, normalize, parseGlossary } from './text.js';
import { TranslationScheduler, type TranslationJob } from './translation-scheduler.js';

const MAX_AHEAD_MS = 15_000; // reject clients that send audio much faster than real time
const DUPLICATE_WINDOW_MS = 3_000;
const TERMINATOR_END = /[。！？!?]["”」』）)]*$/u;

/** Characters the recognizer can repeat from `overlapMs` of replayed audio (about 10 per second, plus slack). */
const overlapChars = (overlapMs: number): number => Math.ceil((overlapMs / 1000) * 10) + 2;

export interface SessionOptions extends Providers {
  send: (msg: ServerMessage) => void;
  settings: SessionSettings;
  /** Audio-clock offset so timestamps continue across reconnects. */
  offsetMs?: number;
  partialsEnabled?: boolean;
  log?: (message: string, extra?: unknown) => void;
}

/**
 * One live captioning session. It only coordinates; each stage lives in its own module:
 *
 *   audio -> AudioSegmenter -> speech-to-text -> sentence splitting -> TranslationScheduler -> client
 *
 * - Live text: while someone speaks, the current segment is re-transcribed about once a second.
 *   Whisper-style providers do not stream, so this is a repeated full transcription of the
 *   segment so far. It is reported to the client as "rerun", never as native streaming.
 * - Speech-to-text calls never overlap (one lane). A stale live refresh is aborted when its
 *   segment finalizes.
 * - Translation runs separately and concurrently, so a slow translation never delays the next
 *   segment's transcript.
 */
export class TranslatorSession {
  private settings: SessionSettings;
  private readonly stt: Providers['stt'];
  private readonly translator: Providers['translator'];
  private readonly send: (msg: ServerMessage) => void;
  private readonly log: (message: string, extra?: unknown) => void;
  private readonly partialsEnabled: boolean;

  private readonly segmenter: AudioSegmenter;
  private readonly scheduler: TranslationScheduler;
  private readonly sttLane = new Lane();
  private readonly draftLane = new Lane();
  private finalChain: Promise<void> = Promise.resolve();
  private interimAbort: AbortController | null = null;

  private readonly startedAtWall = Date.now();
  private receivedMs = 0;

  private prevText = '';
  private recentJa: string[] = [];
  private lastFinal = { norm: '', endMs: -1e9 };
  private lastInterim = { id: '', text: '' };
  private readonly finalIds = new Set<string>();
  private emptyStreak = 0;
  private draftRev = 0;
  private lastDraftEmitted = 0;

  private halted = false;
  private disposed = false;
  private transcribing = false;
  private speaking = false;
  private lastActivity: Activity = 'idle';
  private readonly warnedAt = new Map<ErrorCode, number>();

  constructor(opts: SessionOptions) {
    this.stt = opts.stt;
    this.translator = opts.translator;
    this.send = opts.send;
    this.settings = opts.settings;
    this.partialsEnabled = opts.partialsEnabled ?? true;
    this.log = opts.log ?? (() => undefined);

    this.segmenter = new AudioSegmenter(
      {
        profile: () => PROFILES[this.settings.latency],
        canInterim: () => Boolean(this.stt) && this.partialsEnabled && !this.halted && this.emptyStreak < 2 && !this.sttLane.busy,
        onInterim: (snap) => this.runInterim(snap),
        onSegment: (seg) => this.enqueueFinal(seg),
        onSpeech: (speaking) => {
          this.speaking = speaking;
          this.emitActivity();
        },
      },
      opts.offsetMs ?? 0,
    );

    this.scheduler = new TranslationScheduler({
      translate: (job, context, signal) =>
        withRetry(
          () =>
            (this.translator as NonNullable<Providers['translator']>).translate({
              text: job.text,
              context,
              glossary: this.settings.glossary,
              partial: false,
              continuation: job.continuation,
              incomplete: job.incomplete,
              signal,
            }),
          signal,
        ),
      onResult: (id, thai) => {
        if (this.disposed) return;
        this.send({ type: 'translation', id, text: thai, final: true });
        this.emitActivity();
      },
      onFailure: (id, error) => {
        if (this.disposed) return;
        if (error) this.handleProviderError(error, 'translate', false);
        this.send({ type: 'translation_failed', id });
        this.emitActivity();
      },
    });
  }

  updateSettings(patch: Partial<SessionSettings>): void {
    this.settings = { ...this.settings, ...patch };
  }

  /** Feed one chunk of 16 kHz mono PCM16 little-endian audio. Returns false if the client is flooding. */
  pushAudio(buf: Uint8Array): boolean {
    if (this.disposed || this.halted) return true;
    const samples = buf.byteLength >> 1;
    if (samples === 0) return true;
    const pcm = new Int16Array(samples);
    new Uint8Array(pcm.buffer).set(buf.subarray(0, samples * 2));

    this.receivedMs += (samples * 1000) / SAMPLE_RATE;
    if (this.receivedMs - (Date.now() - this.startedAtWall) > MAX_AHEAD_MS) return false;
    this.segmenter.push(pcm);
    return true;
  }

  /** Flush the segment in progress, wait for every transcript and translation, then confirm. */
  async stop(): Promise<void> {
    this.segmenter.flush();
    await this.finalChain;
    await this.scheduler.drain(10_000);
    if (!this.disposed) this.send({ type: 'stopped' });
  }

  dispose(): void {
    this.disposed = true;
    this.interimAbort?.abort();
    this.interimAbort = null;
    this.scheduler.dispose();
  }

  /** Visible for tests: timers and requests still alive. */
  get activity() {
    return { scheduler: this.scheduler.stats, sttBusy: this.sttLane.busy };
  }

  // ---- live text ------------------------------------------------------------------------

  private runInterim(snap: InterimSnapshot): void {
    const ac = new AbortController();
    this.interimAbort = ac;
    void this.sttLane.run(async () => {
      try {
        const result = await this.callStt(snap.pcm, ac.signal);
        if (ac.signal.aborted || this.disposed || this.finalIds.has(snap.id) || this.segmenter.activeId !== snap.id) return;
        if (this.settings.sourceLang === 'auto' && !isJapaneseLanguage(result.language)) return;

        let text = cleanTranscript(result.text);
        if (text && snap.continuation && this.prevText) text = trimOverlap(this.prevText, text, overlapChars(snap.overlapMs));
        if (!text || isHallucination(text)) return;

        const same = this.lastInterim.id === snap.id;
        if (same && text === this.lastInterim.text) return;
        // The part that survived this refresh unchanged; the client shows the rest as still settling.
        const stable = same ? commonPrefixLength(this.lastInterim.text, text) : 0;
        this.lastInterim = { id: snap.id, text };

        this.send({ type: 'transcript', id: snap.id, seq: snap.seq, sub: 0, text, final: false, stable, language: result.language, startMs: snap.startMs, endMs: snap.endMs });
        if (this.settings.partialTranslation) this.translateDraft(snap.id, text);
      } catch (err) {
        if (!ac.signal.aborted) this.handleProviderError(err, 'stt', true);
      }
    });
  }

  /** Optional dimmed Thai draft of live text. Never confirmed, and a late older draft can't overwrite a newer one. */
  private translateDraft(id: string, text: string): void {
    const translator = this.translator;
    if (!translator || this.halted || this.draftLane.busy) return;
    const rev = ++this.draftRev;
    void this.draftLane.run(async () => {
      try {
        const th = await translator.translate({
          text,
          context: this.scheduler.recentContext(3),
          glossary: this.settings.glossary,
          partial: true,
        });
        if (!th || this.disposed || this.finalIds.has(id) || rev <= this.lastDraftEmitted) return;
        this.lastDraftEmitted = rev;
        this.send({ type: 'translation', id, text: th, final: false });
      } catch (err) {
        this.handleProviderError(err, 'translate', true);
      }
    });
  }

  // ---- finished segments ----------------------------------------------------------------

  private enqueueFinal(seg: Segment): void {
    this.interimAbort?.abort(); // frees the recognizer for the final pass
    this.finalChain = this.finalChain.then(() => this.processFinal(seg)).catch((err) => this.log('final processing failed', err));
  }

  private discard(id: string): void {
    this.send({ type: 'discard', id });
  }

  private async processFinal(seg: Segment): Promise<void> {
    if (this.disposed) return;
    if (!this.stt || this.halted || seg.speechMs < MIN_SPEECH_MS) return this.discard(seg.id);

    this.transcribing = true;
    this.emitActivity();
    let result: SttResult;
    try {
      result = await this.sttLane.run(() => this.callStt(seg.pcm));
    } catch (err) {
      this.handleProviderError(err, 'stt', false);
      this.transcribing = false;
      this.emitActivity();
      return this.discard(seg.id);
    }
    this.transcribing = false;
    this.emitActivity();
    if (this.disposed) return;

    let text = cleanTranscript(result.text);
    if (text && seg.continuation && this.prevText) text = trimOverlap(this.prevText, text, overlapChars(seg.overlapMs));
    const norm = normalize(text);
    const notJapanese = this.settings.sourceLang === 'auto' && !isJapaneseLanguage(result.language);
    // Whisper sometimes loops on one phrase; a long identical line right after itself is that, not speech.
    const duplicate = norm.length >= 6 && norm === this.lastFinal.norm && seg.startMs - this.lastFinal.endMs < DUPLICATE_WINDOW_MS;
    if (!text || isHallucination(text) || notJapanese || duplicate) {
      this.emptyStreak++;
      return this.discard(seg.id);
    }

    this.emptyStreak = 0;
    this.lastFinal = { norm, endMs: seg.endMs };
    this.prevText = text;
    this.recentJa = [...this.recentJa, text].slice(-3);

    // One long stretch of speech often holds several sentences. Each becomes its own subtitle
    // and its own translation request, so Thai appears in short readable pieces.
    const pieces = splitJapanese(text, DEFAULT_LIMITS);
    const times = allocateTimes(pieces, seg.startMs, seg.endMs);
    pieces.forEach((piece, i) => {
      const id = i === 0 ? seg.id : `${seg.id}.${i}`;
      this.finalIds.add(id);
      this.send({
        type: 'transcript',
        id,
        seq: seg.seq,
        sub: i,
        text: piece,
        final: true,
        stable: piece.length,
        language: result.language,
        startMs: times[i].startMs,
        endMs: times[i].endMs,
      });
      if (this.translator) {
        const job: TranslationJob = {
          id,
          text: piece,
          continuation: seg.continuation && i === 0,
          incomplete: seg.forced && i === pieces.length - 1 && !TERMINATOR_END.test(piece),
        };
        this.scheduler.submit(job);
      }
    });
    this.emitActivity();
  }

  private callStt(pcm: Int16Array, signal?: AbortSignal): Promise<SttResult> {
    const stt = this.stt;
    if (!stt) return Promise.reject(new ProviderError('PROVIDER', 'No speech recognizer configured'));
    const wav = pcm16ToWav(pcm);
    const terms = parseGlossary(this.settings.glossary).map((g) => g.ja);
    const prompt = [...terms, this.recentJa.slice(-2).join('')].filter(Boolean).join('、').slice(-200);
    return withRetry(
      () => stt.transcribe(wav, { language: this.settings.sourceLang === 'ja' ? 'ja' : undefined, prompt: prompt || undefined, signal }),
      signal,
    );
  }

  // ---- status and errors ----------------------------------------------------------------

  private emitActivity(): void {
    const next: Activity = this.transcribing ? 'transcribing' : this.speaking ? 'hearing' : this.scheduler.pending > 0 ? 'translating' : 'idle';
    if (next === this.lastActivity || this.disposed) return;
    this.lastActivity = next;
    this.send({ type: 'activity', state: next });
  }

  private warn(code: ErrorCode, message: string): void {
    const now = Date.now();
    if (now - (this.warnedAt.get(code) ?? 0) < 8000) return;
    this.warnedAt.set(code, now);
    this.send({ type: 'error', code, message, severity: 'warning', recoverable: true });
  }

  private handleProviderError(err: unknown, kind: 'stt' | 'translate', quiet: boolean): void {
    const code = err instanceof ProviderError ? err.code : 'PROVIDER';
    if (code === 'ABORTED') return;
    this.log(`${kind} error`, err instanceof Error ? err.message : err);

    if (code === 'QUOTA_EXCEEDED') {
      this.halted = true;
      this.send({ type: 'error', code: 'QUOTA_EXCEEDED', message: 'The provider reports that the quota or credit is used up.', severity: 'error', recoverable: false });
    } else if (code === 'AUTH') {
      this.halted = true;
      this.send({ type: 'error', code: 'PROVIDER_AUTH', message: 'The provider rejected the API key.', severity: 'error', recoverable: false });
    } else if (code === 'RATE_LIMITED') {
      this.warn('RATE_LIMITED', 'The provider is rate limiting requests. Subtitles may be delayed.');
    } else if (!quiet) {
      this.warn(kind === 'stt' ? 'STT_FAILED' : 'TRANSLATE_FAILED', kind === 'stt' ? 'One line could not be transcribed.' : 'One line could not be translated.');
    }
  }
}
