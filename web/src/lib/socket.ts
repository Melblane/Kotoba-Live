import type { ClientMessage, ServerMessage } from '@/types';

export interface CloseInfo {
  code: number;
  wasReady: boolean;
}

export function backendUrl(path: string, ws = false): string {
  const override = import.meta.env?.VITE_BACKEND_URL as string | undefined; // e.g. https://api.example.com
  if (override) return override.replace(/^http/, ws ? 'ws' : 'http').replace(/\/$/, '') + path;
  if (ws) return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${path}`;
  return path;
}

/** Thin WebSocket wrapper: JSON control messages in both directions, binary PCM upstream. */
export class TranslatorSocket {
  private ws: WebSocket | null = null;
  private ready = false;
  private closedByUs = false;

  constructor(
    private readonly onMessage: (msg: ServerMessage) => void,
    private readonly onClose: (info: CloseInfo) => void,
  ) {}

  get isReady(): boolean {
    return this.ready;
  }

  /** Resolves once the server answers the start message with "ready". */
  connect(start: Extract<ClientMessage, { type: 'start' }>, timeoutMs = 8000): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(backendUrl('/ws', true));
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      const timer = setTimeout(() => {
        reject(new Error('Connection timed out'));
        this.close();
      }, timeoutMs);

      ws.onopen = () => ws.send(JSON.stringify(start));
      ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') return;
        let msg: ServerMessage;
        try {
          msg = JSON.parse(ev.data) as ServerMessage;
        } catch {
          return;
        }
        if (msg.type === 'ready') {
          this.ready = true;
          clearTimeout(timer);
          resolve();
        }
        this.onMessage(msg);
      };
      ws.onclose = (ev) => {
        clearTimeout(timer);
        const wasReady = this.ready;
        this.ready = false;
        if (!wasReady) reject(new Error('Connection closed'));
        if (!this.closedByUs) this.onClose({ code: ev.code, wasReady });
      };
    });
  }

  sendJson(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** Drops the frame instead of queueing when the connection cannot keep up. */
  sendAudio(pcm: ArrayBuffer): void {
    if (!this.ready || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.ws.bufferedAmount > 512_000) return;
    this.ws.send(pcm);
  }

  close(): void {
    this.closedByUs = true;
    this.ready = false;
    const ws = this.ws;
    this.ws = null;
    if (ws && ws.readyState <= WebSocket.OPEN) ws.close(1000);
  }
}
