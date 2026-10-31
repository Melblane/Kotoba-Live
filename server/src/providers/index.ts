import type { AppConfig } from '../config.js';
import { OpenAiCompatibleStt } from './stt.js';
import { OpenAiCompatibleTranslator } from './translate.js';
import type { Providers } from './types.js';

/** Wires configured providers. A provider without an API key is left null, never faked. */
export function buildProviders(config: AppConfig): Providers {
  return {
    stt: config.stt.apiKey ? new OpenAiCompatibleStt(config.stt) : null,
    translator: config.llm.apiKey ? new OpenAiCompatibleTranslator(config.llm) : null,
  };
}
