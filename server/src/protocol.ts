import { z } from 'zod';

export const SAMPLE_RATE = 16_000;

export const sessionSettingsSchema = z.object({
  sourceLang: z.enum(['ja', 'auto']).default('ja'),
  latency: z.enum(['fast', 'balanced', 'accurate']).default('balanced'),
  partialTranslation: z.boolean().default(false),
  glossary: z.string().max(2000).default(''),
});
export type SessionSettings = z.infer<typeof sessionSettingsSchema>;

export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('start'),
    token: z.string().max(256).optional(),
    offsetMs: z.number().int().min(0).max(86_400_000).default(0),
    settings: sessionSettingsSchema.default({}),
  }),
  z.object({ type: z.literal('settings'), settings: sessionSettingsSchema.partial() }),
  z.object({ type: z.literal('stop') }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

export type ErrorCode =
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

export type Activity = 'idle' | 'hearing' | 'transcribing' | 'translating';

/** How live Japanese text is produced while someone is still speaking. */
export type InterimMode = 'none' | 'rerun' | 'native';

/**
 * Messages sent from server to browser. Mirrored in web/src/types.ts.
 *
 * `seq` and `sub` give the spoken order: `seq` counts segments, `sub` counts the pieces a
 * segment was split into. A segment's first piece keeps the id its live text already had.
 */
export type ServerMessage =
  | {
      type: 'ready';
      stt: { configured: boolean; model: string; streaming: boolean; interim: InterimMode };
      translate: { configured: boolean; model: string };
    }
  | { type: 'activity'; state: Activity }
  | { type: 'transcript'; id: string; seq: number; sub: number; text: string; final: boolean; stable: number; language?: string; startMs: number; endMs: number }
  | { type: 'translation'; id: string; text: string; final: boolean }
  | { type: 'translation_failed'; id: string }
  | { type: 'discard'; id: string }
  | { type: 'error'; code: ErrorCode; message: string; severity: 'warning' | 'error'; recoverable: boolean }
  | { type: 'stopped' };
