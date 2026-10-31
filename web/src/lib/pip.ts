import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { OverlayRow, Settings } from '@/types';

export type PipSupport = 'document' | 'video' | 'none';

interface DocumentPipApi {
  requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
}

export function detectPipSupport(): PipSupport {
  if (typeof window === 'undefined') return 'none';
  if ('documentPictureInPicture' in window) return 'document';
  if (document.pictureInPictureEnabled && typeof HTMLCanvasElement.prototype.captureStream === 'function') return 'video';
  return 'none';
}

function copyStyles(target: Window): void {
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const style = target.document.createElement('style');
      style.textContent = Array.from(sheet.cssRules).map((r) => r.cssText).join('\n');
      target.document.head.appendChild(style);
    } catch {
      // Cross-origin sheets (Google Fonts) cannot be read, so link them instead.
      if (sheet.href) {
        const link = target.document.createElement('link');
        link.rel = 'stylesheet';
        link.href = sheet.href;
        target.document.head.appendChild(link);
      }
    }
  }
}

// ---- canvas renderer for the video-based fallback ---------------------------------------

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, locale: string): string[] {
  const Segmenter = (Intl as unknown as { Segmenter?: new (l: string, o: { granularity: 'word' }) => { segment(s: string): Iterable<{ segment: string }> } }).Segmenter;
  const tokens = Segmenter ? Array.from(new Segmenter(locale, { granularity: 'word' }).segment(text), (s) => s.segment) : Array.from(text);
  const lines: string[] = [];
  let line = '';
  for (const token of tokens) {
    if (line && ctx.measureText(line + token).width > maxWidth) {
      lines.push(line.trim());
      line = token.trimStart();
    } else {
      line += token;
    }
  }
  if (line.trim()) lines.push(line.trim());
  return lines.slice(0, 3);
}

interface RowBlock {
  row: OverlayRow;
  ja: string[];
  th: string[];
  jaSize: number;
  thSize: number;
  height: number;
  alpha: number;
}

/** Draws the whole subtitle stack, oldest on top and newest at the bottom, for the video fallback. */
export function drawRows(canvas: HTMLCanvasElement, rows: OverlayRow[], s: Settings): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { width: W, height: H } = canvas;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  const live = rows.filter((r) => !r.leaving);
  if (live.length === 0) {
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '500 26px "Instrument Sans", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('Waiting for speech…', W / 2, H / 2);
    return;
  }

  const maxWidth = W * 0.88;
  const pad = 14;
  const gap = 8;
  const jaFont = (size: number) => `500 ${size}px "Zen Kaku Gothic New", "Hiragino Sans", "Yu Gothic", sans-serif`;
  const thFont = (size: number) => `500 ${size}px Kanit, "IBM Plex Sans Thai", Tahoma, sans-serif`;

  const build = (list: OverlayRow[], scale: number): RowBlock[] =>
    list.map((row, i) => {
      const thSize = s.fontSize * scale;
      const jaSize = (row.showTh ? s.fontSize * 0.62 : s.fontSize) * scale;
      ctx.font = jaFont(jaSize);
      const ja = row.showJa && row.ja ? wrap(ctx, row.ja, maxWidth, 'ja') : [];
      ctx.font = thFont(thSize);
      const th = row.showTh && row.th ? wrap(ctx, row.th, maxWidth, 'th') : [];
      const depth = list.length - 1 - i;
      const alpha = (depth === 0 ? 1 : depth === 1 ? 0.85 : 0.7) * (row.status === 'interim' ? 0.75 : 1);
      return { row, ja, th, jaSize, thSize, alpha, height: ja.length * jaSize * 1.4 + th.length * thSize * 1.5 + pad * 2 };
    });
  const totalOf = (b: RowBlock[]) => b.reduce((h, x) => h + x.height, 0) + gap * Math.max(0, b.length - 1);

  let blocks: RowBlock[] = [];
  let scale = 1;
  for (let n = Math.min(live.length, s.overlayLines); n >= 1; n--) {
    blocks = build(live.slice(-n), 1);
    if (totalOf(blocks) <= H - 32) break;
  }
  while (totalOf(blocks) > H - 32 && scale > 0.4) {
    scale *= 0.85;
    blocks = build(blocks.map((b) => b.row), scale);
  }

  const total = totalOf(blocks);
  let y = s.position === 'top' ? 16 : s.position === 'center' ? (H - total) / 2 : H - total - 16;
  for (const b of blocks) {
    let widest = 0;
    for (const [lines, font] of [[b.ja, jaFont(b.jaSize)], [b.th, thFont(b.thSize)]] as const) {
      ctx.font = font;
      for (const l of lines) widest = Math.max(widest, ctx.measureText(l).width);
    }
    ctx.globalAlpha = b.alpha;
    ctx.fillStyle = `rgba(8,9,14,${s.bgOpacity / 100})`;
    ctx.beginPath();
    ctx.roundRect(W / 2 - widest / 2 - pad * 1.5, y, widest + pad * 3, b.height, 14);
    ctx.fill();

    let ty = y + pad;
    ctx.fillStyle = s.textColor;
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = 6;
    ctx.font = jaFont(b.jaSize);
    for (const l of b.ja) {
      ctx.fillText(l, W / 2, ty);
      ty += b.jaSize * 1.4;
    }
    ctx.font = thFont(b.thSize);
    for (const l of b.th) {
      ctx.fillText(l, W / 2, ty);
      ty += b.thSize * 1.5;
    }
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
    y += b.height + gap;
  }
}

// ---- hook ---------------------------------------------------------------------------------

interface VideoPip {
  video: HTMLVideoElement;
  canvas: HTMLCanvasElement;
  timer: number;
}

/**
 * Subtitles in a window that stays on top of other apps. Uses Document Picture-in-Picture
 * (Chromium 116+) when present, otherwise a canvas rendered into a video Picture-in-Picture.
 */
export function usePip(rows: OverlayRow[], settings: Settings) {
  const support = useMemo(detectPipSupport, []);
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const [videoActive, setVideoActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoPip = useRef<VideoPip | null>(null);
  const latest = useRef({ rows, settings });
  latest.current = { rows, settings };

  const closeVideo = useCallback(() => {
    const v = videoPip.current;
    if (!v) return;
    window.clearInterval(v.timer);
    if (document.pictureInPictureElement === v.video) void document.exitPictureInPicture().catch(() => undefined);
    (v.video.srcObject as MediaStream | null)?.getTracks().forEach((t) => t.stop());
    v.video.srcObject = null;
    v.video.remove();
    videoPip.current = null;
    setVideoActive(false);
  }, []);

  const open = useCallback(async () => {
    setError(null);
    try {
      if (support === 'document') {
        const api = (window as unknown as { documentPictureInPicture: DocumentPipApi }).documentPictureInPicture;
        const win = await api.requestWindow({ width: 760, height: 220 });
        copyStyles(win);
        win.document.title = 'Kotoba Live subtitles';
        win.document.body.className = 'm-0 overflow-hidden bg-black font-sans text-fg';
        win.addEventListener('pagehide', () => setPipWindow(null));
        setPipWindow(win);
      } else if (support === 'video') {
        const canvas = document.createElement('canvas');
        canvas.width = 1280;
        canvas.height = 360;
        const video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.style.cssText = 'position:fixed;left:0;bottom:0;width:2px;height:2px;opacity:0;pointer-events:none';
        document.body.appendChild(video);
        drawRows(canvas, latest.current.rows, latest.current.settings);
        video.srcObject = canvas.captureStream(15);
        try {
          await video.play();
          await video.requestPictureInPicture();
        } catch (err) {
          (video.srcObject as MediaStream | null)?.getTracks().forEach((t) => t.stop());
          video.remove();
          throw err;
        }
        const timer = window.setInterval(() => drawRows(canvas, latest.current.rows, latest.current.settings), 500);
        video.addEventListener('leavepictureinpicture', closeVideo, { once: true });
        videoPip.current = { video, canvas, timer };
        setVideoActive(true);
      } else {
        setError('This browser has no Picture-in-Picture support for subtitles. Use the in-app overlay instead.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open the subtitle window.');
    }
  }, [support, closeVideo]);

  const close = useCallback(() => {
    pipWindow?.close();
    closeVideo();
  }, [pipWindow, closeVideo]);

  useEffect(() => {
    if (videoActive && videoPip.current) drawRows(videoPip.current.canvas, rows, settings);
  }, [videoActive, rows, settings]);

  useEffect(() => () => closeVideo(), [closeVideo]);
  useEffect(() => () => pipWindow?.close(), [pipWindow]);

  return { support, active: Boolean(pipWindow) || videoActive, open, close, pipWindow, error };
}
