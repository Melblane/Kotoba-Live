export type DisplayMode = 'thai' | 'both' | 'japanese';
export type SubtitlePosition = 'top' | 'center' | 'bottom';
export type Latency = 'fast' | 'balanced' | 'accurate';
export type SourceLang = 'ja' | 'auto';

export interface Settings {
  sourceLang: SourceLang;
  displayMode: DisplayMode;
  overlayEnabled: boolean;
  fontSize: number; // px at a 1280 px wide screen
  textColor: string;
  bgOpacity: number; // 0-100
  position: SubtitlePosition;
  showPartials: boolean;
  autoScroll: boolean;
  latency: Latency;
  glossary: string;
  accessToken: string;
  /** Multiplier on how long finished lines stay on screen. */
  overlayDuration: number;
  /** Most subtitle lines shown at once. */
  overlayLines: number;
  /** History mode: lines stay about three times longer. */
  keepLonger: boolean;
  /** Dimmed Thai draft of text that is still being spoken. */
  draftTranslation: boolean;
}

// ---- WebSocket protocol (mirrors server/src/protocol.ts) --------------------------------

export interface SessionSettings {
  sourceLang: SourceLang;
  latency: Latency;
  partialTranslation: boolean;
  glossary: string;
}

export type ClientMessage =
  | { type: 'start'; token?: string; offsetMs: number; settings: SessionSettings }
  | { type: 'settings'; settings: Partial<SessionSettings> }
  | { type: 'stop' };

export type ServerErrorCode =
  | 'CONFIG_MISSING'
  | 'TRANSLATE_NOT_CONFIGURED'
  | 'AUTH_REQUIRED'
  | 'QUOTA_EXCEEDED'
  | 'RATE_LIMITED'
  | 'PROVIDER_AUTH'
  | 'STT_FAILED'
  | 'TRANSLATE_FAILED'
  | 'BAD_REQUEST'
  | 'SERVER_BUSY';

export type InterimMode = 'none' | 'rerun' | 'native';

export type ServerMessage =
  | {
      type: 'ready';
      stt: { configured: boolean; model: string; streaming: boolean; interim: InterimMode };
      translate: { configured: boolean; model: string };
    }
  | { type: 'activity'; state: 'idle' | 'hearing' | 'transcribing' | 'translating' }
  | { type: 'transcript'; id: string; seq: number; sub: number; text: string; final: boolean; stable: number; language?: string; startMs: number; endMs: number }
  | { type: 'translation'; id: string; text: string; final: boolean }
  | { type: 'translation_failed'; id: string }
  | { type: 'discard'; id: string }
  | { type: 'error'; code: ServerErrorCode; message: string; severity: 'warning' | 'error'; recoverable: boolean }
  | { type: 'stopped' };

export interface Health {
  ok: boolean;
  version: string;
  authRequired: boolean;
  partials: boolean;
  stt: { configured: boolean; provider: string; model: string; streaming: boolean; interim: InterimMode };
  translate: { configured: boolean; provider: string; model: string };
}

// ---- Subtitle data ----------------------------------------------------------------------

export interface SubtitleEntry {
  id: string;
  /** Capture session number, so history from separate runs stays distinguishable. */
  session: number;
  /** Position in spoken order across the whole history. Entries are always kept sorted by it. */
  order: number;
  ja: string;
  th: string;
  jaFinal: boolean;
  thFinal: boolean;
  /** The translation was attempted and failed; the Japanese is all there is. */
  thFailed: boolean;
  /** How much of a live Japanese line survived the last refresh unchanged. */
  jaStable: number;
  /** Milliseconds since the capture session began (audio clock). */
  startMs: number;
  endMs: number;
  wallTime: number;
  /** When the Japanese became final (wall clock). */
  jaFinalAt: number | null;
  demo?: boolean;
}

/**
 * interim:     still being heard, text may change
 * translating: Japanese is final, Thai is on its way
 * final:       everything that will be shown is here
 * expired:     past its reading time (it stays in the history)
 */
export type SubtitleStatus = 'interim' | 'translating' | 'final' | 'expired';

/** One line of the on-screen stack. Rows are keyed by id, so a line is updated in place, never replaced. */
export interface OverlayRow {
  id: string;
  ja: string;
  th: string;
  /** Characters of `ja` that were already there on the previous refresh. */
  stable: number;
  status: Exclude<SubtitleStatus, 'expired'>;
  /** Fading out; removed shortly after. */
  leaving: boolean;
  showJa: boolean;
  showTh: boolean;
}

// ---- Capture state -----------------------------------------------------------------------

export type Phase =
  | 'idle'
  | 'selecting'
  | 'ready'
  | 'connecting'
  | 'listening'
  | 'transcribing'
  | 'translating'
  | 'stopping'
  | 'error';

export type IssueCode =
  | 'unsupported'
  | 'permission-denied'
  | 'no-audio'
  | 'capture-ended'
  | 'server-unreachable'
  | 'connection-lost'
  | 'config-missing'
  | 'translate-missing'
  | 'quota-exceeded'
  | 'rate-limited'
  | 'provider-auth'
  | 'auth-required'
  | 'line-failed'
  | 'unknown';

export type IssueAction = 'select' | 'retry-server' | 'reconnect' | 'stop' | 'demo' | 'settings';

export interface Issue {
  code: IssueCode;
  severity: 'error' | 'warning' | 'info';
  title: string;
  message: string;
  actions: IssueAction[];
}

export interface SourceInfo {
  surface: 'browser' | 'window' | 'monitor' | 'unknown';
  hasAudio: boolean;
}
