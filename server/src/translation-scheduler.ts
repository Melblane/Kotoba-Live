export interface TranslationJob {
  /** Subtitle id the result belongs to. */
  id: string;
  text: string;
  /** This line continues a line that was cut off mid-sentence. */
  continuation: boolean;
  /** This line is cut off mid-sentence and the speaker carries on in the next one. */
  incomplete: boolean;
}

export interface ContextLine {
  ja: string;
  /** Null when that earlier line has not been translated yet. */
  th: string | null;
}

export interface SchedulerHooks {
  translate(job: TranslationJob, context: ContextLine[], signal: AbortSignal): Promise<string>;
  /** Called once per job, in audio order (except after a head-of-line timeout). */
  onResult(id: string, thai: string): void;
  onFailure(id: string, error: unknown): void;
}

export interface SchedulerOptions {
  maxConcurrent?: number;
  /** How long a slow request may hold back later finished ones. */
  headWaitMs?: number;
  contextLines?: number;
}

interface Entry {
  job: TranslationJob;
  reqId: string;
  logIdx: number;
  state: 'queued' | 'running' | 'done';
  thai: string | null;
  error: unknown;
  abort: AbortController | null;
  headSince: number | null;
}

/**
 * Translates finished segments, several at a time, and releases the results in the order
 * they were spoken. Each request carries only the new segment plus a few earlier lines as
 * context, never the whole transcript.
 */
export class TranslationScheduler {
  private readonly order: Entry[] = [];
  private readonly ids = new Set<string>();
  private readonly log: ContextLine[] = [];
  private logBase = 0;
  private running = 0;
  private counter = 0;
  private headTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly waiters = new Set<{ done: () => void; timer: ReturnType<typeof setTimeout> }>();
  private disposed = false;
  private readonly maxConcurrent: number;
  private readonly headWaitMs: number;
  private readonly contextLines: number;

  constructor(private readonly hooks: SchedulerHooks, opts: SchedulerOptions = {}) {
    this.maxConcurrent = opts.maxConcurrent ?? 3;
    this.headWaitMs = opts.headWaitMs ?? 4_000;
    this.contextLines = opts.contextLines ?? 4;
  }

  /** Jobs submitted but not yet released. */
  get pending(): number {
    return this.order.length;
  }

  get stats() {
    return { pending: this.order.length, running: this.running, timers: (this.headTimer ? 1 : 0) + this.waiters.size };
  }

  submit(job: TranslationJob): void {
    if (this.disposed || this.ids.has(job.id)) return; // never translate or emit the same subtitle twice
    this.ids.add(job.id);
    const logIdx = this.logBase + this.log.push({ ja: job.text, th: null }) - 1;
    this.order.push({ job, reqId: `r${++this.counter}`, logIdx, state: 'queued', thai: null, error: null, abort: null, headSince: null });
    if (this.log.length > 120) {
      this.log.splice(0, 60);
      this.logBase += 60;
    }
    this.pump();
    this.flush();
  }

  /** The last few lines, for callers that translate outside the queue (draft translations). */
  recentContext(n: number): ContextLine[] {
    return this.log.slice(-n).map((l) => ({ ...l }));
  }

  /** Resolves when everything submitted has been released, or after `timeoutMs`. */
  drain(timeoutMs = 10_000): Promise<void> {
    if (this.order.length === 0 || this.disposed) return Promise.resolve();
    return new Promise((resolve) => {
      const waiter = {
        timer: setTimeout(() => finish(), timeoutMs),
        done: () => finish(),
      };
      const finish = () => {
        clearTimeout(waiter.timer);
        this.waiters.delete(waiter);
        resolve();
      };
      this.waiters.add(waiter);
    });
  }

  dispose(): void {
    this.disposed = true;
    for (const e of this.order) e.abort?.abort();
    this.order.length = 0;
    if (this.headTimer) clearTimeout(this.headTimer);
    this.headTimer = null;
    for (const w of [...this.waiters]) w.done();
  }

  // ---- internals ------------------------------------------------------------------------

  private contextFor(e: Entry): ContextLine[] {
    const idx = e.logIdx - this.logBase;
    return this.log.slice(Math.max(0, idx - this.contextLines), Math.max(0, idx)).map((l) => ({ ...l }));
  }

  private pump(): void {
    while (this.running < this.maxConcurrent) {
      const next = this.order.find((e) => e.state === 'queued');
      if (!next) return;
      this.start(next);
    }
  }

  private start(e: Entry): void {
    e.state = 'running';
    e.abort = new AbortController();
    this.running++;
    const context = this.contextFor(e);
    this.hooks.translate(e.job, context, e.abort.signal).then(
      (thai) => this.finish(e, thai, null),
      (error) => this.finish(e, null, error),
    );
  }

  private finish(e: Entry, thai: string | null, error: unknown): void {
    this.running--;
    e.state = 'done';
    e.thai = thai && thai.trim() ? thai.trim() : null;
    e.error = error;
    if (this.disposed) return;
    const line = this.log[e.logIdx - this.logBase];
    if (line && e.thai) line.th = e.thai;
    this.flush();
    this.pump();
  }

  private release(e: Entry): void {
    if (e.thai) this.hooks.onResult(e.job.id, e.thai);
    else this.hooks.onFailure(e.job.id, e.error);
  }

  private flush(): void {
    if (this.disposed) return;
    while (this.order.length && this.order[0].state === 'done') this.release(this.order.shift() as Entry);

    const head = this.order[0];
    if (head) {
      head.headSince ??= Date.now();
      if (Date.now() - head.headSince >= this.headWaitMs) {
        // The oldest request is slow: let finished later ones through instead of freezing the subtitles.
        for (let i = 1; i < this.order.length; ) {
          if (this.order[i].state === 'done') this.release(this.order.splice(i, 1)[0]);
          else i++;
        }
      }
    }
    this.armHeadTimer();
    if (this.order.length === 0) for (const w of [...this.waiters]) w.done();
  }

  private armHeadTimer(): void {
    if (this.headTimer) clearTimeout(this.headTimer);
    this.headTimer = null;
    const head = this.order[0];
    if (!head || head.state === 'done' || this.disposed) return;
    const since = head.headSince ?? Date.now();
    this.headTimer = setTimeout(() => {
      this.headTimer = null;
      this.flush();
    }, Math.max(0, since + this.headWaitMs - Date.now()) + 5);
  }
}
