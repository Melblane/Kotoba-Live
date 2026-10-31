import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

// Load <repo>/.env (works from both src/ and dist/).
dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

export interface ProviderConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface AppConfig {
  port: number;
  host: string;
  allowedOrigins: string[];
  accessToken: string;
  maxConnectionsPerIp: number;
  partialsEnabled: boolean;
  stt: ProviderConfig & { verboseJson: boolean };
  llm: ProviderConfig & { temperature: number | null };
}

const str = (v: string | undefined, fallback = ''): string => (v ?? fallback).trim();
const trimSlash = (v: string): string => v.replace(/\/+$/, '');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const openaiKey = str(env.OPENAI_API_KEY);
  const sttModel = str(env.STT_MODEL, 'whisper-1');
  const format = str(env.STT_RESPONSE_FORMAT, /^gpt-4o/.test(sttModel) ? 'json' : 'verbose_json');

  let temperature: number | null = 0.2;
  if (env.LLM_TEMPERATURE !== undefined) {
    const raw = env.LLM_TEMPERATURE.trim();
    temperature = raw === '' || Number.isNaN(Number(raw)) ? null : Number(raw);
  }

  return {
    port: Number(env.PORT ?? 8787),
    host: str(env.HOST, '127.0.0.1'),
    allowedOrigins: str(env.ALLOWED_ORIGINS)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    accessToken: str(env.ACCESS_TOKEN),
    maxConnectionsPerIp: Number(env.MAX_CONNECTIONS_PER_IP ?? 3),
    partialsEnabled: str(env.ENABLE_PARTIALS, 'true').toLowerCase() !== 'false',
    stt: {
      baseUrl: trimSlash(str(env.STT_BASE_URL, 'https://api.openai.com/v1')),
      apiKey: str(env.STT_API_KEY) || openaiKey,
      model: sttModel,
      verboseJson: format === 'verbose_json',
    },
    llm: {
      baseUrl: trimSlash(str(env.LLM_BASE_URL, 'https://api.openai.com/v1')),
      apiKey: str(env.LLM_API_KEY) || openaiKey,
      model: str(env.LLM_MODEL, 'gpt-4o-mini'),
      temperature,
    },
  };
}
