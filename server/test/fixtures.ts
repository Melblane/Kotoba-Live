import assert from 'node:assert/strict';
import type { ServerMessage, SessionSettings } from '../src/protocol.js';
import type { SttProvider, TranslateProvider, TranslationRequest } from '../src/providers/types.js';
import { TranslatorSession } from '../src/session.js';

export const SR = 16_000;
export const FRAME = 1600; // 100 ms, what the browser sends
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const silence = (ms: number) => new Int16Array((SR * ms) / 1000);
export function tone(ms: number, amp: number): Int16Array {
  const out = new Int16Array((SR * ms) / 1000);
  for (let i = 0; i < out.length; i++) out[i] = Math.round(Math.sin((2 * Math.PI * 220 * i) / SR) * amp * 32767);
  return out;
}
export function join(...parts: Int16Array[]): Int16Array {
  const out = new Int16Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
export function* frames(pcm: Int16Array): Generator<Uint8Array> {
  for (let i = 0; i < pcm.length; i += FRAME) {
    const slice = pcm.slice(i, i + FRAME);
    yield new Uint8Array(slice.buffer, slice.byteOffset, slice.byteLength);
  }
}

const samplesOf = (wav: Uint8Array) => new Int16Array(wav.buffer.slice(wav.byteOffset + 44, wav.byteOffset + wav.byteLength));

/** Loudness picks the sentence, so two different "utterances" give two different texts. */
export class FakeStt implements SttProvider {
  name = 'fake';
  model = 'fake-stt';
  streaming = false;
  calls = 0;
  constructor(private readonly override?: string) {}
  async transcribe(wav: Uint8Array): Promise<{ text: string }> {
    this.calls++;
    await sleep(1);
    if (this.override) return { text: this.override };
    let max = 0;
    for (const s of samplesOf(wav)) max = Math.max(max, Math.abs(s));
    return { text: max < 15_000 ? 'こんにちは、元気ですか。' : 'さようなら、また明日。' };
  }
}

// ---- a recognizer that really reads the audio it is given -------------------------------------
// One character per 100 ms of audio, encoded in the tone's loudness. It transcribes whatever
// range it receives, so overlapping audio produces overlapping text, exactly like a real
// recognizer would, and the pipeline has to remove the repeat itself.

const ALPHABET = 'あいうえおかきくけこさしすせそたちつてと';

export function charText(length: number): string {
  let x = 7;
  let out = '';
  for (let i = 0; i < length; i++) {
    x = (x * 17 + 11) % 97;
    out += ALPHABET[x % ALPHABET.length];
  }
  return out;
}
export function charAudio(text: string): Int16Array {
  return join(...Array.from(text, (ch) => tone(100, 0.2 + 0.02 * ALPHABET.indexOf(ch))));
}

export class CharStt implements SttProvider {
  name = 'char';
  model = 'char-stt';
  streaming = false;
  calls = 0;
  async transcribe(wav: Uint8Array): Promise<{ text: string }> {
    this.calls++;
    await sleep(1);
    const s = samplesOf(wav);
    let text = '';
    for (let i = 0; i + FRAME <= s.length; i += FRAME) {
      let max = 0;
      for (let j = i; j < i + FRAME; j++) max = Math.max(max, Math.abs(s[j]));
      const amp = max / 32767;
      if (amp < 0.1) continue;
      text += ALPHABET[Math.min(ALPHABET.length - 1, Math.max(0, Math.round((amp - 0.2) / 0.02)))];
    }
    return { text };
  }
}

export class FakeTranslator implements TranslateProvider {
  name = 'fake';
  model = 'fake-llm';
  requests: TranslationRequest[] = [];
  finished: string[] = [];
  constructor(private readonly delayFor: (n: number, req: TranslationRequest) => number = () => 1) {}
  async translate(req: TranslationRequest): Promise<string> {
    const n = this.requests.push(req);
    await sleep(this.delayFor(n, req));
    this.finished.push(req.text);
    return `TH(${req.text})`;
  }
}

export const defaultSettings: SessionSettings = { sourceLang: 'ja', latency: 'balanced', partialTranslation: false, glossary: '' };

export async function runSession(
  audio: Int16Array,
  opts: { stt?: SttProvider; translator?: TranslateProvider | null; settings?: SessionSettings; pace?: number } = {},
) {
  const messages: ServerMessage[] = [];
  const session = new TranslatorSession({
    stt: opts.stt ?? new FakeStt(),
    translator: opts.translator === undefined ? new FakeTranslator() : opts.translator,
    send: (m) => messages.push(m),
    settings: opts.settings ?? defaultSettings,
  });
  for (const f of frames(audio)) {
    assert.equal(session.pushAudio(f), true);
    await sleep(opts.pace ?? 2);
  }
  await session.stop();
  const leftovers = session.activity; // what is still running after a clean stop
  session.dispose();
  return { messages, session, leftovers };
}

type Msg<T extends ServerMessage['type']> = Extract<ServerMessage, { type: T }>;
export const finals = (m: ServerMessage[]) => m.filter((x): x is Msg<'transcript'> => x.type === 'transcript' && x.final);
export const translations = (m: ServerMessage[]) => m.filter((x): x is Msg<'translation'> => x.type === 'translation' && x.final);
