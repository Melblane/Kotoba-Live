**English** | [ภาษาไทย](README.th.md)

# Kotoba Live

Real-time Japanese to Thai subtitles for whatever is playing in a browser tab. You pick a tab or window, Kotoba Live listens to its audio, transcribes the Japanese, translates it into conversational Thai, and shows the result as subtitles. It works well for anime, dramas, livestreams and everyday video.

```
 Browser tab audio
        │  getDisplayMedia (you choose the source in the browser's own dialog)
        ▼
 AudioWorklet  ── mono, 16 kHz, 100 ms PCM frames ──►  WebSocket  ──►  Node server
                                                                          │
                         AudioSegmenter: pauses, length limit, overlap
                                                                          │
                  speech-to-text (live text while speaking, final at pauses)
                                                                          │
                     sentence splitting (。！？, clauses) + overlap removal
                                                                          │
              TranslationScheduler: concurrent, ordered, context + glossary
                                                                          ▼
 history (everything)  ◄── events ──►  subtitle queue (what is on screen now)
                                          stage · floating overlay · Picture-in-Picture
```

## Quick start

Requires Node 20.6 or newer and a desktop Chromium browser (Chrome or Edge).

```bash
npm install
cp .env.example .env      # then add your API key(s), see below
npm run dev               # http://localhost:5173
```

Open http://localhost:5173, click **Select Window / Tab**, choose the tab with your video, tick **Also share tab audio**, then **Start Listening**.

For a single-process production run: `npm run build && npm start` and open http://127.0.0.1:8787.

No API key yet? The app still opens. Click **Try demo data** to see the interface with sample lines. Demo lines are always labeled and are never mixed into exports.

## Configuration

Keys live in `.env` on the server and never reach the browser. Both services speak the OpenAI-compatible API, so you can point them at several providers.

| Variable | Purpose | Examples |
| --- | --- | --- |
| `STT_BASE_URL`, `STT_API_KEY`, `STT_MODEL` | Speech recognition (`/audio/transcriptions`) | OpenAI `whisper-1`; Groq `whisper-large-v3-turbo` at `https://api.groq.com/openai/v1`; a local faster-whisper or whisper.cpp server |
| `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` | Translation (`/chat/completions`) | OpenAI `gpt-4o-mini`; Groq; OpenRouter; Ollama |
| `OPENAI_API_KEY` | Shortcut when OpenAI does both jobs | |
| `ACCESS_TOKEN` | Require a token before sessions can start | Set this if the server is reachable by anyone but you |
| `HOST`, `PORT`, `ALLOWED_ORIGINS` | Network binding and extra allowed WebSocket origins | Defaults: `127.0.0.1`, `8787` |
| `ENABLE_PARTIALS` | Live partial transcripts | `false` cuts speech-to-text cost roughly fourfold |

Local servers usually ignore the key but it must be non-empty. If only the speech key is set, you still get Japanese transcription and a clear notice that translation is not configured.

## Using it

- **Select Window / Tab** opens the browser's picker and shows a live level meter, so you can confirm audio is arriving before anything is sent to a server. **Start Listening** begins transcription (and opens the picker first if you haven't chosen a source). **Change source** switches tabs without interrupting the session.
- **Stop Listening** releases every media track at once, finishes the sentence in progress, and closes the connection.
- Statuses are Idle, Connecting, Listening, Processing and Error, with a detail line and recovery buttons for each problem (permission denied, no audio in the source, connection lost, missing keys, quota exceeded, capture ended by the browser).
- If the connection drops, capture stays alive and the app reconnects with backoff (six attempts) while keeping timestamps continuous.
- **Settings** control content (Thai only, Japanese and Thai, Japanese only), font size, color, background opacity, position, how many lines are visible, how long finished lines stay (plus a Keep subtitles longer mode), live Japanese text, an optional dimmed Thai draft, auto-scroll, a latency preference, and a glossary (`田中 = ทานากะ`) that keeps names consistent. Preferences persist in the browser.
- **History** shows timestamps, copy buttons (Thai, or both languages), a confirmed Clear, and export to TXT or SRT.

### Which source gives audio

| Share | Audio |
| --- | --- |
| Chrome or Edge **tab** | Yes. Tick **Also share tab audio**. This is the recommended choice. |
| **Entire screen** | System audio on Windows and ChromeOS, when offered in the dialog |
| Application **window** | Usually none |

Firefox and Safari do not share tab audio, so the app reports that instead of pretending to work.

### Why subtitles can't float over other tabs

A website cannot draw on top of other tabs or desktop apps. That is a browser security rule. Kotoba Live gives you two supported options:

1. **In-app overlay**: a floating subtitle panel over this app.
2. **Picture-in-Picture window**: a real always-on-top window you can drag over your video. Chrome and Edge 116+ use Document Picture-in-Picture and follow all your subtitle settings. Other browsers with video PiP get a canvas-rendered fallback, with size and position controlled by the browser.

Subtitles over any app (including full-screen games) would need a separate desktop app. A sensible extension is an Electron shell that reuses this server and the `SubtitleBox` component in a transparent, always-on-top, click-through `BrowserWindow`, with audio from `desktopCapturer` loopback. It is not part of this project.

## How the pipeline behaves

### What you see

- **A stack, not a single line.** Subtitles appear at the bottom of the stack and older ones move up, with a short slide (about 280 ms, `transform` only) and a fade. A new line never removes an older line that is still being read. Older lines are slightly dimmer.
- **Each line has a stable id.** Live Japanese, the finished sentence and its Thai all update the same row, so nothing is replaced or re-mounted. The part of a live line that survived the last refresh is drawn normally and the part that is still settling is dimmed.
- **Four states:** *interim* (still being heard), *translating* (Japanese is final, Thai on its way), *final*, and *expired* (past its reading time; it stays in the history).
- **Reading time depends on length.** Short lines stay about 3 to 5 seconds, long ones up to about 9 (scaled by the Subtitle duration setting, capped). The clock starts when the Thai is complete, not while the line is waiting to be translated. If the stack is full, the oldest finished line leaves only after at least 2 seconds, and the newest line is never pushed out. If a translation is lost, the line stops waiting after 15 seconds.
- **The history keeps everything.** The stack is a separate queue (`web/src/lib/subtitleQueue.ts`) that only reads the history, so a line leaving the screen never leaves the transcript.
- **Space aware.** The stack shows only as many rows as fit (at most about 46% of the window height for the floating overlay), up to your Visible lines setting. Reduced-motion preferences are respected.

### How audio becomes lines

- **Segments of one phrase, not a paragraph.** A short breath ends a segment: 250 to 500 ms depending on the latency preset, and a bit longer for very short segments so a hesitation doesn't split a phrase. A segment is also cut after 4, 5 or 6 seconds of speech even without a pause (Fastest, Balanced, Most accurate), at the quietest moment of the last 1.5 seconds.
- **Overlap, then de-duplication.** A segment that follows an unbroken-speech cut starts with 400 ms of replayed audio so no word is clipped. The recognizer then repeats those few characters, and the repeated start is removed by comparing it with the end of the previous segment. This only ever happens to segments known to carry overlap.
- **Sentence splitting.** The finished text is split at 。！？, and a sentence longer than about 34 characters is split at clause commas (、), or after a standalone conjunction such as ので and けど. Splits fall only on word boundaries (via `Intl.Segmenter`), very short pieces are merged into a neighbour, and a long phrase is left whole rather than cut in the middle. Each piece becomes its own subtitle with its own translation request.
- **Translation scheduling.** Up to three requests run at once. Each carries only its own line plus the last few earlier lines (and your glossary), never the whole transcript, and tells the model if the line continues or is cut off, so a split sentence still reads naturally without rewriting a line already on screen. Results are released in spoken order even if the API answers out of order. A request that takes more than 4 seconds stops holding back later ones, and its Thai still fills in its own row when it arrives.
- **Failures are visible.** A line whose translation fails shows its Japanese (and "Translation unavailable" in the history) instead of waiting forever.

### What the live Japanese text really is

Whisper-style providers return one result per request; they do not stream. While someone speaks, Kotoba Live therefore **re-transcribes the current segment about once a second** and shows the result as dimmed, unsettled text. The Settings and Dashboard pages say so, and the server reports `interim: "rerun"`. If you turn `ENABLE_PARTIALS` off the server reports `none` and lines appear when their sentence ends. A provider that truly streams would report `native`; none is built in yet (add one behind the `SttProvider` interface, with `streaming = true`).

Re-transcription has limits worth knowing: the end of a live line can still change, and the optional Thai draft (off by default) can change meaning as more is heard. Only finished lines are ever treated as confirmed.

### Tuning

| What | Where |
| --- | --- |
| Pause lengths, maximum segment length, how often live text refreshes | `PROFILES` in `server/src/segmenter.ts` |
| Overlap and pre-roll audio | `OVERLAP_MS`, `PREROLL_MS` in `server/src/segmenter.ts` |
| Characters per subtitle, minimum piece size | `DEFAULT_LIMITS` in `server/src/sentences.ts` |
| Translation concurrency, context lines, wait for a slow request | `TranslationScheduler` options in `server/src/translation-scheduler.ts` |
| Reading time, fade, minimum time on screen | `readingMs`, `FADE_MS`, `MIN_SHOW_MS` in `web/src/lib/subtitleQueue.ts` |

**Cost**: live text re-sends the segment so far. With segments capped at 4 to 6 seconds this is lighter than before, but billed speech-to-text audio is still roughly 2 to 3 times the amount of speech. Turn it off (`ENABLE_PARTIALS=false`), use *Most accurate* latency, or use a cheap or local model if that matters to you. Each sentence is now its own translation request, so translation calls are more numerous but much shorter.

## Security and privacy

- API keys are read only on the server. `/api/health` reports configured or not, never a key.
- The WebSocket accepts same-origin requests plus `ALLOWED_ORIGINS`, validates every message with a schema, caps frame sizes, rejects clients that stream faster than real time, limits connections per IP, and rate-limits the HTTP API.
- Audio is held in memory only for the sentence being processed and is never written to disk or logged. There is no recording feature.
- The server binds to `127.0.0.1` by default. If you expose it, use HTTPS and set `ACCESS_TOKEN`.
- Your provider receives the audio and text you send it, under its own privacy terms.

## Project layout

```
server/src
  app.ts            HTTP + WebSocket server, origin checks, limits
  segmenter.ts      audio buffering, pauses, length limit, overlap (no transcription logic)
  sentences.ts      Japanese sentence and clause splitting, overlap removal
  translation-scheduler.ts   concurrent translation, ordered release, context
  session.ts        coordinates the stages above and handles errors
  audio.ts text.ts  WAV encoding, VAD, serial lanes, hallucination filter, glossary
  providers/        STT and translation (OpenAI-compatible), swappable interfaces
server/test         pipeline tests, including real WebSocket sessions
web/public/pcm-worklet.js   mono mix, 16 kHz resample, 100 ms frames, level
web/src/lib
  capture.ts        getDisplayMedia + AudioWorklet
  controller.ts     capture, socket, reconnect and stop lifecycle
  entries.ts        the history: ordered by spoken order, edited by id
  subtitleQueue.ts  what is on screen: stack, reading time, expiry (separate from the history)
  pip.ts            Document PiP with video fallback
web/src/components  Sidebar, Live, Dashboard, History, Settings, overlays
web/test            UI smoke test (jsdom), controller lifecycle test, audio worklet test
```

## Tests

`npm test` runs 68 tests (31 server, 37 web):

- **Server pipeline**, using a recognizer that really reads the audio it is given (one character per 100 ms), so overlapping audio produces overlapping text: continuous speech is cut into short segments with nothing lost or repeated, live text appears before the sentence is final, a short breath ends a segment, a slow translation never holds back the next transcript, translations are released in spoken order even when the API answers out of order, long recognizer output becomes several subtitles, and stopping leaves no timers or pending requests.
- **Text and scheduling units**: sentence and clause splitting, overlap removal, concurrency limits, slow and failed requests, de-duplication, and clean disposal.
- **Network**: full sessions over a real WebSocket, plus origin, token and malformed-message checks.
- **Web logic**: the history reducer (spoken order, late events, finals never overwritten), the subtitle queue (stacking, stable ids, reading-clock start, length-based time, overflow rules, history mode, fading, no resurrection), export formats, settings validation, and the video-PiP canvas drawing.
- **Lifecycle**: a controller test with a fake capture and WebSocket covers listening, out-of-order events, reconnecting with continuous timestamps, stopping, the browser ending the share, and a quota error, and checks that **no timer is left running** afterwards.
- **UI smoke test** (jsdom): with the overlay on, demo lines stack, the older line stays while the newer one appears, leaves after its reading time, and is still in the history.
- **Audio worklet**: resampling and framing at 48, 44.1 and 16 kHz.

Not covered by automated tests: the real browser picker and tab audio, Picture-in-Picture windows and the slide animation in a real browser, how well a real recognizer handles overlapping audio (different kanji or kana spellings of the repeated characters can leave a small duplicate), and calls to live speech and translation providers. Those need a real browser and your keys. The checklist below is the quickest way to exercise them.

### Manual check (about five minutes)

1. `npm run dev`, open the app in Chrome or Edge, and play a Japanese video with continuous speech (a talk show or a vlog works well) in another tab.
2. Select that tab with **Also share tab audio** ticked, switch on **In-app overlay**, and click **Open PiP window**. Drag the PiP window over the video.
3. Watch for: Japanese appearing while a sentence is still being spoken (dimmed at the end); Thai arriving in short pieces rather than a paragraph; the newest line at the bottom with older lines sliding up; older lines fading only after you have had time to read them.
4. Open **Subtitle History**: every line, including ones that already left the screen, should be there. Export an SRT and check the times.
5. In **Settings** try Visible lines, Subtitle duration and Keep subtitles longer; the preview updates immediately.
6. Click **Stop Listening** and confirm the browser's sharing indicator disappears.
7. If lines are cut too early or too late for your material, adjust the latency preference first, then the values in the Tuning table.

## Troubleshooting

- **"Source has no audio"**: pick a Chrome tab and tick *Also share tab audio*.
- **"Can't reach the server"**: `npm run dev` must be running. If you changed `PORT`, restart both processes.
- **Speech or translation "not set up"**: check `.env`, then restart the server. The Dashboard shows what it detects.
- **Quota or key errors**: the provider's message is logged server-side. The browser only sees a short summary.
- **Subtitles feel late**: pick *Fastest* latency. Use a faster speech model, or run one locally.
- **Odd text over music**: the app discards the most common hallucinations and stops requesting partials after repeated empty results, but heavy background music will still lower accuracy.
