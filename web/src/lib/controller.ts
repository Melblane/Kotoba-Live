import { AudioCapture, CaptureError } from './capture';
import { DEMO_LINES } from './demo';
import { entriesReducer, type EntryAction } from './entries';
import { issueFromServer, makeIssue } from './issues';
import { DEFAULT_SETTINGS } from './settings';
import { backendUrl, TranslatorSocket, type CloseInfo } from './socket';
import type { Health, InterimMode, Issue, IssueCode, Phase, ServerMessage, SessionSettings, Settings, SourceInfo, SubtitleEntry } from '@/types';

export interface ControllerState {
  phase: Phase;
  issue: Issue | null;
  source: SourceInfo | null;
  health: Health | null;
  healthState: 'checking' | 'ok' | 'offline';
  entries: SubtitleEntry[];
  /** Audio captured in the current listening run, in ms. Updated once a second. */
  capturedMs: number;
  demo: boolean;
  session: number;
  /** How live Japanese text is produced by the connected server, once known. */
  sttInterim: InterimMode | null;
}

/** Phases in which audio frames are being produced and counted. */
const STREAMING: readonly Phase[] = ['connecting', 'listening', 'transcribing', 'translating'];
const MAX_RECONNECTS = 6;
const TRANSIENT_ISSUES: readonly IssueCode[] = ['line-failed', 'rate-limited'];

/**
 * Owns the whole capture to transcribe to translate lifecycle outside React, so media tracks,
 * timers and sockets have exactly one place where they are created and released.
 */
export class TranslatorController {
  private state: ControllerState = {
    phase: 'idle',
    issue: null,
    source: null,
    health: null,
    healthState: 'checking',
    entries: [],
    capturedMs: 0,
    demo: false,
    session: 0,
    sttInterim: null,
  };
  private readonly listeners = new Set<() => void>();
  private readonly levelListeners = new Set<(rms: number) => void>();

  private settings: Settings = DEFAULT_SETTINGS;
  private capture: AudioCapture | null = null;
  private socket: TranslatorSocket | null = null;
  private connId = 0;
  private capturedMs = 0;
  private userStopping = false;
  private failed = false;
  private reconnectAttempt = 0;
  private sentSettings = '';
  private timers: Partial<Record<'reconnect' | 'tick' | 'stop' | 'health' | 'settings' | 'issue', number>> = {};
  private demoTimers: number[] = [];

  // ---- store plumbing --------------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getState = (): ControllerState => this.state;

  onLevel(listener: (rms: number) => void): () => void {
    this.levelListeners.add(listener);
    return () => this.levelListeners.delete(listener);
  }

  private set(patch: Partial<ControllerState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }
  private dispatch(action: EntryAction): void {
    const entries = entriesReducer(this.state.entries, action);
    if (entries !== this.state.entries) this.set({ entries });
  }
  private clearTimer(name: keyof typeof this.timers): void {
    window.clearTimeout(this.timers[name]);
    window.clearInterval(this.timers[name]);
    delete this.timers[name];
  }
  private setIssue(code: IssueCode, detail?: string): void {
    this.clearTimer('issue');
    const issue = makeIssue(code, detail);
    this.set({ issue });
    if (TRANSIENT_ISSUES.includes(code)) {
      this.timers.issue = window.setTimeout(() => {
        if (this.state.issue === issue) this.set({ issue: null });
      }, 8000);
    }
  }

  // ---- lifecycle -------------------------------------------------------------------

  init(): void {
    void this.checkHealth();
    this.timers.health = window.setInterval(() => void this.checkHealth(), 15_000);
  }

  dispose(): void {
    this.stopDemo();
    for (const name of Object.keys(this.timers) as Array<keyof typeof this.timers>) this.clearTimer(name);
    this.releaseCapture();
    this.socket?.close();
    this.socket = null;
  }

  setSettings(settings: Settings): void {
    this.settings = settings;
    this.clearTimer('settings');
    this.timers.settings = window.setTimeout(() => {
      const next = JSON.stringify(this.sessionSettings());
      if (this.socket?.isReady && next !== this.sentSettings) {
        this.sentSettings = next;
        this.socket.sendJson({ type: 'settings', settings: this.sessionSettings() });
      }
    }, 400);
  }

  private sessionSettings(): SessionSettings {
    const s = this.settings;
    return { sourceLang: s.sourceLang, latency: s.latency, partialTranslation: s.showPartials && s.draftTranslation, glossary: s.glossary };
  }

  async checkHealth(): Promise<void> {
    try {
      const res = await fetch(backendUrl('/api/health'), { signal: AbortSignal.timeout(4000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const health = (await res.json()) as Health;
      this.set({ health, healthState: 'ok' });
      const code = this.state.issue?.code;
      if ((code === 'server-unreachable') || (code === 'config-missing' && health.stt.configured)) this.set({ issue: null });
    } catch {
      this.set({ healthState: 'offline' });
    }
  }

  // ---- source selection ------------------------------------------------------------

  /** Opens the browser's own picker. Works before listening starts and while listening (switches source). */
  async selectSource(): Promise<boolean> {
    const before = this.state.phase;
    if (before === 'stopping' || before === 'selecting') return false;
    if (!AudioCapture.isSupported()) {
      this.setIssue('unsupported');
      return false;
    }
    this.stopDemo();
    if (!STREAMING.includes(before)) this.set({ phase: 'selecting', issue: null });

    try {
      const cap = await AudioCapture.open({
        onFrame: (pcm) => this.onFrame(pcm),
        onLevel: (rms) => this.levelListeners.forEach((l) => l(rms)),
        onEnded: (c) => {
          if (c === this.capture) this.handleCaptureEnded();
        },
      });
      const previous = this.capture;
      this.capture = cap;
      previous?.stop();
      this.set({ source: cap.info, issue: null, phase: STREAMING.includes(this.state.phase) ? this.state.phase : 'ready' });
      return true;
    } catch (err) {
      const code: IssueCode = err instanceof CaptureError ? err.code : 'unknown';
      const phase = STREAMING.includes(this.state.phase) ? this.state.phase : this.capture ? 'ready' : 'idle';
      this.set({ phase, issue: makeIssue(code, err instanceof Error ? err.message : undefined) });
      return false;
    }
  }

  private releaseCapture(): void {
    this.capture?.stop();
    this.capture = null;
  }

  private handleCaptureEnded(): void {
    const streaming = STREAMING.includes(this.state.phase);
    this.set({ issue: makeIssue('capture-ended') });
    if (streaming) {
      this.beginStop();
    } else {
      this.releaseCapture();
      this.set({ phase: 'idle', source: null });
    }
  }

  // ---- listening -------------------------------------------------------------------

  async startListening(): Promise<void> {
    const phase = this.state.phase;
    if (STREAMING.includes(phase) || phase === 'stopping' || phase === 'selecting') return;

    // Check server readiness before the picker opens so nobody shares a tab and then hits an error.
    if (this.state.healthState === 'offline') await this.checkHealth();
    if (this.state.healthState === 'offline') return this.setIssue('server-unreachable');
    if (this.state.health && !this.state.health.stt.configured) return this.setIssue('config-missing');
    if (this.state.health?.authRequired && !this.settings.accessToken) return this.setIssue('auth-required');

    if (!this.capture && !(await this.selectSource())) return;

    this.stopDemo();
    this.dispatch({ type: 'removeDemo' });
    this.userStopping = false;
    this.failed = false;
    this.reconnectAttempt = 0;
    this.capturedMs = 0;
    this.set({ session: this.state.session + 1, phase: 'connecting', issue: null, capturedMs: 0 });
    this.timers.tick = window.setInterval(() => this.set({ capturedMs: this.capturedMs }), 1000);

    if (!(await this.openSocket()) && !this.failed && !this.userStopping) this.scheduleReconnect();
  }

  async stopListening(): Promise<void> {
    const phase = this.state.phase;
    if (phase === 'stopping') return;
    this.clearTimer('reconnect');
    if (STREAMING.includes(phase)) return this.beginStop();
    // Not streaming: release a selected-but-unused source, or reset after an error.
    this.releaseCapture();
    this.set({ phase: 'idle', source: null, issue: null });
  }

  /** Stops audio immediately, then lets the server finish the sentence in progress. */
  private beginStop(): void {
    this.userStopping = true;
    this.clearTimer('reconnect');
    this.releaseCapture();
    const socket = this.socket;
    if (socket?.isReady) {
      this.set({ phase: 'stopping', source: null });
      socket.sendJson({ type: 'stop' });
      this.timers.stop = window.setTimeout(() => this.finishStop(), 5000);
    } else {
      this.finishStop();
    }
  }

  private finishStop(): void {
    this.clearTimer('stop');
    this.clearTimer('tick');
    this.clearTimer('reconnect');
    this.socket?.close();
    this.socket = null;
    this.userStopping = false;
    const keep = this.state.issue && this.state.issue.code !== 'translate-missing' ? this.state.issue : null;
    this.set({ phase: 'idle', source: null, issue: keep, capturedMs: this.capturedMs });
  }

  async reconnect(): Promise<void> {
    if (!this.capture) {
      await this.startListening();
      return;
    }
    this.clearTimer('reconnect');
    this.reconnectAttempt = 0;
    this.failed = false;
    this.set({ phase: 'connecting', issue: null });
    if (!(await this.openSocket()) && !this.failed && !this.userStopping) this.scheduleReconnect();
  }

  private async openSocket(): Promise<boolean> {
    const id = ++this.connId;
    const socket: TranslatorSocket = new TranslatorSocket(
      (msg) => this.onServer(id, msg),
      (info) => this.onSocketClose(socket, info),
    );
    this.socket?.close();
    this.socket = socket;
    try {
      await socket.connect({
        type: 'start',
        token: this.settings.accessToken || undefined,
        offsetMs: Math.round(this.capturedMs),
        settings: this.sessionSettings(),
      });
    } catch {
      if (this.socket === socket) this.socket = null;
      socket.close();
      return false;
    }
    if (this.socket !== socket || this.failed || this.userStopping) return false;
    this.reconnectAttempt = 0;
    this.sentSettings = JSON.stringify(this.sessionSettings());
    const issue = this.state.issue?.code === 'connection-lost' ? null : this.state.issue;
    this.set({ phase: 'listening', issue });
    return true;
  }

  private onFrame(pcm: ArrayBuffer): void {
    if (!STREAMING.includes(this.state.phase)) return;
    this.capturedMs += pcm.byteLength / 32; // 16 samples per ms, 2 bytes each
    this.socket?.sendAudio(pcm);
  }

  private onSocketClose(socket: TranslatorSocket, info: CloseInfo): void {
    if (this.socket !== socket) return;
    this.socket = null;
    if (!info.wasReady || this.failed) return; // failed connects are handled where they were attempted
    if (this.userStopping) return this.finishStop();
    if (info.code === 1008) return this.fail(makeIssue('unknown'));
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (!this.capture || this.userStopping || this.failed) return;
    this.reconnectAttempt++;
    if (this.reconnectAttempt > MAX_RECONNECTS) {
      this.set({
        phase: 'error',
        issue: { ...makeIssue('connection-lost'), message: "Couldn't reach the server after several attempts. Check that it is still running, then reconnect." },
      });
      return;
    }
    const delayMs = Math.min(8000, 1000 * 2 ** (this.reconnectAttempt - 1));
    this.set({
      phase: 'connecting',
      issue: {
        ...makeIssue('connection-lost'),
        message: `Retrying in ${Math.round(delayMs / 1000)}s (attempt ${this.reconnectAttempt} of ${MAX_RECONNECTS}). Audio is not being transcribed meanwhile.`,
        actions: ['stop'],
      },
    });
    this.timers.reconnect = window.setTimeout(async () => {
      if (!this.capture || this.userStopping || this.failed) return;
      if (!(await this.openSocket()) && !this.failed && !this.userStopping) this.scheduleReconnect();
    }, delayMs);
  }

  /** Fatal problem: release everything so nothing keeps capturing. */
  private fail(issue: Issue): void {
    this.failed = true;
    this.clearTimer('reconnect');
    this.clearTimer('tick');
    this.releaseCapture();
    this.socket?.close();
    this.socket = null;
    this.set({ phase: 'error', issue, source: null });
  }

  // ---- server events ---------------------------------------------------------------

  private onServer(connId: number, msg: ServerMessage): void {
    if (connId !== this.connId) return;
    const key = (id: string) => `c${connId}:${id}`;
    switch (msg.type) {
      case 'activity': {
        const p = this.state.phase;
        if (p === 'listening' || p === 'transcribing' || p === 'translating') {
          const next: Phase = msg.state === 'transcribing' ? 'transcribing' : msg.state === 'translating' ? 'translating' : 'listening';
          if (next !== p) this.set({ phase: next });
        }
        break;
      }
      case 'transcript':
        this.dispatch({
          type: 'transcript',
          key: key(msg.id),
          // connection, then segment, then piece: the spoken order, even if events arrive late
          order: connId * 1e9 + msg.seq * 1e3 + msg.sub,
          text: msg.text,
          final: msg.final,
          stable: msg.stable,
          startMs: msg.startMs,
          endMs: msg.endMs,
          session: this.state.session,
          at: Date.now(),
        });
        break;
      case 'translation':
        this.dispatch({ type: 'translation', key: key(msg.id), text: msg.text, final: msg.final });
        break;
      case 'translation_failed':
        this.dispatch({ type: 'translationFailed', key: key(msg.id) });
        break;
      case 'discard':
        this.dispatch({ type: 'discard', key: key(msg.id) });
        break;
      case 'error': {
        const code = issueFromServer(msg.code);
        if (msg.severity === 'error') this.fail(makeIssue(code, msg.message));
        else if (this.state.phase !== 'error') this.setIssue(code);
        break;
      }
      case 'stopped':
        if (this.userStopping) this.finishStop();
        break;
      case 'ready':
        this.set({ sttInterim: msg.stt.interim });
        break;
    }
  }

  // ---- history and demo ------------------------------------------------------------

  dismissIssue(): void {
    this.clearTimer('issue');
    this.set({ issue: null });
  }

  clearHistory(): void {
    this.dispatch({ type: 'clear' });
  }

  startDemo(): void {
    const phase = this.state.phase;
    if (STREAMING.includes(phase) || phase === 'stopping' || this.state.demo) return;
    this.dispatch({ type: 'removeDemo' });
    const session = this.state.session + 1;
    this.set({ demo: true, session, issue: null });

    const later = (ms: number, fn: () => void) => this.demoTimers.push(window.setTimeout(fn, ms));
    const draft = this.settings.showPartials && this.settings.draftTranslation;
    const gap = 3400;
    DEMO_LINES.forEach((line, i) => {
      const key = `demo${session}:${i}`;
      const at = 400 + i * gap;
      const startMs = i * gap;
      const base = { key, order: 1e15 + session * 1e6 + i * 1e3, startMs, endMs: startMs + 2400, session, demo: true };
      const first = line.ja.slice(0, Math.ceil(line.ja.length * 0.4));
      const second = line.ja.slice(0, Math.ceil(line.ja.length * 0.75));
      // Live Japanese grows, and only the new tail is marked as unsettled.
      later(at, () => this.dispatch({ type: 'transcript', ...base, text: first, final: false, stable: 0, at: Date.now() }));
      later(at + 500, () => this.dispatch({ type: 'transcript', ...base, text: second, final: false, stable: first.length, at: Date.now() }));
      later(at + 1000, () => this.dispatch({ type: 'transcript', ...base, text: line.ja, final: true, stable: line.ja.length, at: Date.now() }));
      if (draft) later(at + 1200, () => this.dispatch({ type: 'translation', key, text: line.th.slice(0, Math.ceil(line.th.length * 0.5)), final: false }));
      later(at + 1700, () => this.dispatch({ type: 'translation', key, text: line.th, final: true }));
    });
    later(400 + DEMO_LINES.length * gap, () => this.set({ demo: false }));
  }

  stopDemo(): void {
    this.demoTimers.forEach((t) => window.clearTimeout(t));
    this.demoTimers = [];
    if (this.state.demo) this.set({ demo: false });
  }
}
