import type { SourceInfo } from '@/types';

export type CaptureErrorCode = 'permission-denied' | 'no-audio' | 'unsupported' | 'unknown';

export class CaptureError extends Error {
  constructor(public readonly code: CaptureErrorCode, message: string) {
    super(message);
    this.name = 'CaptureError';
  }
}

export interface CaptureEvents {
  /** 100 ms of 16 kHz mono PCM16. Ownership of the buffer transfers to the callee. */
  onFrame(pcm: ArrayBuffer): void;
  onLevel(rms: number): void;
  /** The user (or the browser) ended sharing. Not called for stop() on our side. */
  onEnded(capture: AudioCapture): void;
}

/**
 * Captures audio from a tab, window or screen the user picks in the browser's own dialog,
 * and converts it to 16 kHz PCM on an AudioWorklet. Nothing is captured without that dialog.
 */
export class AudioCapture {
  private stopped = false;
  private readonly endedHandlers: Array<[MediaStreamTrack, () => void]> = [];

  private constructor(
    readonly info: SourceInfo,
    private readonly stream: MediaStream,
    private readonly ctx: AudioContext,
    private readonly source: MediaStreamAudioSourceNode,
    private readonly node: AudioWorkletNode,
    private readonly sink: GainNode,
  ) {}

  static isSupported(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices &&
      typeof navigator.mediaDevices.getDisplayMedia === 'function' &&
      typeof AudioWorkletNode !== 'undefined'
    );
  }

  static async open(events: CaptureEvents): Promise<AudioCapture> {
    if (!AudioCapture.isSupported()) throw new CaptureError('unsupported', 'Screen capture with audio is not available in this browser.');

    let stream: MediaStream;
    try {
      // Browsers require video here even though only the audio is used. The video track is
      // disabled and never rendered. The options below are Chromium extensions, hence the cast.
      const constraints = {
        video: true,
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        systemAudio: 'include',
        selfBrowserSurface: 'exclude',
        surfaceSwitching: 'include',
      } as unknown as DisplayMediaStreamOptions;
      stream = await navigator.mediaDevices.getDisplayMedia(constraints);
    } catch (err) {
      const name = err instanceof DOMException ? err.name : '';
      if (name === 'NotAllowedError' || name === 'AbortError') throw new CaptureError('permission-denied', 'Sharing was cancelled or blocked.');
      if (name === 'NotSupportedError' || name === 'TypeError') throw new CaptureError('unsupported', 'This browser cannot capture that kind of source.');
      throw new CaptureError('unknown', err instanceof Error ? err.message : 'Could not start capture.');
    }

    const video = stream.getVideoTracks()[0];
    const surface = (video?.getSettings() as { displaySurface?: string } | undefined)?.displaySurface;
    const info: SourceInfo = {
      surface: surface === 'browser' || surface === 'window' || surface === 'monitor' ? surface : 'unknown',
      hasAudio: stream.getAudioTracks().length > 0,
    };
    if (!info.hasAudio) {
      stream.getTracks().forEach((t) => t.stop());
      throw new CaptureError('no-audio', 'The selected source is not sharing any audio.');
    }
    stream.getVideoTracks().forEach((t) => (t.enabled = false));

    let ctx: AudioContext | null = null;
    try {
      try {
        ctx = new AudioContext({ sampleRate: 16_000, latencyHint: 'interactive' });
      } catch {
        ctx = new AudioContext({ latencyHint: 'interactive' }); // the worklet resamples whatever rate we get
      }
      await ctx.audioWorklet.addModule('/pcm-worklet.js');
      if (ctx.state === 'suspended') await ctx.resume();

      const source = ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
      const node = new AudioWorkletNode(ctx, 'pcm-processor', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2 });
      const sink = ctx.createGain();
      sink.gain.value = 0; // keeps the graph running without playing the tab's audio a second time
      source.connect(node);
      node.connect(sink);
      sink.connect(ctx.destination);

      const capture = new AudioCapture(info, stream, ctx, source, node, sink);
      node.port.onmessage = (e: MessageEvent<{ pcm: ArrayBuffer; rms: number }>) => {
        if (capture.stopped) return;
        events.onLevel(e.data.rms);
        events.onFrame(e.data.pcm);
      };
      for (const track of stream.getTracks()) {
        const handler = () => {
          if (!capture.stopped) events.onEnded(capture);
        };
        track.addEventListener('ended', handler);
        capture.endedHandlers.push([track, handler]);
      }
      return capture;
    } catch (err) {
      stream.getTracks().forEach((t) => t.stop());
      void ctx?.close();
      throw new CaptureError('unknown', err instanceof Error ? err.message : 'Audio processing could not start.');
    }
  }

  /** Releases every track, node and the audio context. Safe to call twice. */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    for (const [track, handler] of this.endedHandlers) track.removeEventListener('ended', handler);
    this.endedHandlers.length = 0;
    this.node.port.onmessage = null;
    this.source.disconnect();
    this.node.disconnect();
    this.sink.disconnect();
    this.stream.getTracks().forEach((t) => t.stop());
    void this.ctx.close().catch(() => undefined);
  }
}
