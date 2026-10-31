import { providerFetch } from './http.js';
import type { SttOptions, SttProvider, SttResult } from './types.js';

interface VerboseSegment {
  text?: string;
  no_speech_prob?: number;
  avg_logprob?: number;
  compression_ratio?: number;
}
interface TranscriptionJson {
  text?: string;
  language?: string;
  segments?: VerboseSegment[];
}

/** Drops segments Whisper itself flags as silence, noise or looping output. */
function keepSegment(s: VerboseSegment): boolean {
  if ((s.compression_ratio ?? 0) > 2.4) return false;
  if ((s.no_speech_prob ?? 0) > 0.6 && (s.avg_logprob ?? 0) < -0.8) return false;
  if ((s.avg_logprob ?? 0) < -1.6) return false;
  return true;
}

/**
 * Works with any OpenAI-compatible /audio/transcriptions endpoint:
 * OpenAI, Groq, faster-whisper-server, whisper.cpp server, and similar.
 */
export class OpenAiCompatibleStt implements SttProvider {
  readonly name: string;
  readonly streaming = false; // /audio/transcriptions returns one result per request
  constructor(private readonly cfg: { baseUrl: string; apiKey: string; model: string; verboseJson: boolean }) {
    this.name = new URL(cfg.baseUrl).host;
  }
  get model(): string {
    return this.cfg.model;
  }

  async transcribe(wav: Uint8Array, options: SttOptions): Promise<SttResult> {
    const form = new FormData();
    form.append('file', new Blob([wav as BlobPart], { type: 'audio/wav' }), 'audio.wav');
    form.append('model', this.cfg.model);
    form.append('response_format', this.cfg.verboseJson ? 'verbose_json' : 'json');
    form.append('temperature', '0');
    if (options.language) form.append('language', options.language);
    if (options.prompt) form.append('prompt', options.prompt);

    const res = await providerFetch(
      `${this.cfg.baseUrl}/audio/transcriptions`,
      { method: 'POST', headers: { Authorization: `Bearer ${this.cfg.apiKey}` }, body: form },
      { signal: options.signal, timeoutMs: 25_000 },
    );
    const json = (await res.json()) as TranscriptionJson;

    let text = json.text ?? '';
    if (json.segments?.length) {
      text = json.segments.filter(keepSegment).map((s) => s.text ?? '').join('');
    }
    return { text: text.trim(), language: json.language };
  }
}
