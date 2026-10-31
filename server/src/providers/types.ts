export type ProviderErrorCode = 'QUOTA_EXCEEDED' | 'RATE_LIMITED' | 'AUTH' | 'PROVIDER' | 'TIMEOUT' | 'ABORTED';

export class ProviderError extends Error {
  constructor(
    public readonly code: ProviderErrorCode,
    message: string,
    public readonly status?: number,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export interface SttOptions {
  /** ISO-639-1 code, or undefined to let the model auto-detect. */
  language?: string;
  /** Prior text and glossary terms that bias recognition toward consistent spelling. */
  prompt?: string;
  signal?: AbortSignal;
}

export interface SttResult {
  text: string;
  /** Language reported by the provider, when available (e.g. "japanese"). */
  language?: string;
}

/** Replace this interface's implementation to change the speech-to-text engine. */
export interface SttProvider {
  readonly name: string;
  readonly model: string;
  /**
   * True only for engines that emit partial results while audio is still arriving. Batch
   * engines (Whisper-style) return false, and live text is then produced by re-transcribing.
   */
  readonly streaming: boolean;
  transcribe(wav: Uint8Array, options: SttOptions): Promise<SttResult>;
}

export interface TranslationRequest {
  text: string;
  /** Earlier lines, oldest first. `th` is null if that line is still being translated. */
  context: Array<{ ja: string; th: string | null }>;
  /** Raw glossary text, one "日本語 = ไทย" per line. */
  glossary: string;
  /** True for a draft of text that is still being spoken and may change. */
  partial: boolean;
  /** This line continues the previous one, which was cut off mid-sentence. */
  continuation?: boolean;
  /** This line is cut off mid-sentence; the speaker continues in the next one. */
  incomplete?: boolean;
  signal?: AbortSignal;
}

/** Replace this interface's implementation to change the translation engine. */
export interface TranslateProvider {
  readonly name: string;
  readonly model: string;
  translate(request: TranslationRequest): Promise<string>;
}

export interface Providers {
  stt: SttProvider | null;
  translator: TranslateProvider | null;
}
