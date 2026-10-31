import type { Issue, IssueCode, ServerErrorCode } from '@/types';

const COPY: Record<IssueCode, Omit<Issue, 'code'>> = {
  unsupported: {
    severity: 'error',
    title: "This browser can't capture tab audio",
    message: 'Capturing audio from a tab needs a desktop Chromium browser such as Chrome or Edge. Firefox and Safari do not share tab audio.',
    actions: ['demo'],
  },
  'permission-denied': {
    severity: 'warning',
    title: 'Sharing was cancelled or blocked',
    message: 'Kotoba Live can only hear a tab or window you choose. Select a source again and confirm the browser prompt.',
    actions: ['select'],
  },
  'no-audio': {
    severity: 'warning',
    title: 'The selected source has no audio',
    message: 'Choose a browser tab and turn on "Also share tab audio" in the sharing dialog. Windows usually share no audio; on Windows and ChromeOS, Entire screen can include system audio.',
    actions: ['select'],
  },
  'capture-ended': {
    severity: 'info',
    title: 'Capture stopped',
    message: 'The shared tab or window was closed, or sharing was stopped from the browser. Select a source to continue.',
    actions: ['select'],
  },
  'server-unreachable': {
    severity: 'error',
    title: "Can't reach the Kotoba server",
    message: 'Start it with "npm run dev" (or "npm start" after a build), then check again.',
    actions: ['retry-server', 'demo'],
  },
  'connection-lost': {
    severity: 'warning',
    title: 'Connection to the server was lost',
    message: 'Audio is not being transcribed until the connection returns.',
    actions: ['reconnect', 'stop'],
  },
  'config-missing': {
    severity: 'warning',
    title: 'Speech recognition is not set up',
    message: 'Add STT_API_KEY (or OPENAI_API_KEY) to the .env file and restart the server. Until then you can look around with demo data.',
    actions: ['demo', 'retry-server'],
  },
  'translate-missing': {
    severity: 'warning',
    title: 'Translation is not set up',
    message: 'Showing the Japanese transcript only. Add LLM_API_KEY (or OPENAI_API_KEY) to .env and restart the server to get Thai.',
    actions: [],
  },
  'quota-exceeded': {
    severity: 'error',
    title: 'Provider quota used up',
    message: 'Your speech or translation provider reports no remaining credit. Add credit or switch provider in .env, restart the server, then start again.',
    actions: ['select', 'settings'],
  },
  'rate-limited': {
    severity: 'warning',
    title: 'Provider is rate limiting requests',
    message: 'Subtitles may arrive late. Choosing the Accurate latency preset sends fewer requests.',
    actions: [],
  },
  'provider-auth': {
    severity: 'error',
    title: 'Provider rejected the API key',
    message: 'Check the key and base URL in .env, restart the server, then start again.',
    actions: ['select'],
  },
  'auth-required': {
    severity: 'error',
    title: 'Access token needed',
    message: 'This server is protected. Enter the access token in Settings, then start again.',
    actions: ['settings'],
  },
  'line-failed': {
    severity: 'warning',
    title: 'A line was skipped',
    message: 'One line could not be processed. Listening continues.',
    actions: [],
  },
  unknown: {
    severity: 'error',
    title: 'Something went wrong',
    message: 'Capture could not continue. Try selecting the source again.',
    actions: ['select'],
  },
};

export function makeIssue(code: IssueCode, detail?: string): Issue {
  const base = COPY[code];
  return { code, ...base, message: detail && code === 'unknown' ? detail : base.message };
}

export function issueFromServer(code: ServerErrorCode): IssueCode {
  switch (code) {
    case 'CONFIG_MISSING': return 'config-missing';
    case 'TRANSLATE_NOT_CONFIGURED': return 'translate-missing';
    case 'AUTH_REQUIRED': return 'auth-required';
    case 'QUOTA_EXCEEDED': return 'quota-exceeded';
    case 'RATE_LIMITED': return 'rate-limited';
    case 'PROVIDER_AUTH': return 'provider-auth';
    case 'STT_FAILED':
    case 'TRANSLATE_FAILED': return 'line-failed';
    default: return 'unknown';
  }
}
