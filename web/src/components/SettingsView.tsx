import { Lock } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/segmented';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { SubtitleStage } from '@/components/SubtitleOverlay';
import { useController, useControllerState } from '@/lib/controller-context';
import { cn } from '@/lib/utils';
import type { InterimMode, Latency, OverlayRow, Settings } from '@/types';

const SWATCHES = ['#ffffff', '#ffe27a', '#8ff0ff', '#b9ffb0', '#ffb3c7'];

const LATENCY_COPY: Record<Latency, string> = {
  fast: 'Reacts to short pauses and cuts sentences at 8 seconds. Lowest delay, but long sentences may be split.',
  balanced: 'Waits for natural pauses and cuts at 12 seconds. A good default for most videos.',
  accurate: 'Waits for longer pauses and allows 18 second sentences. Fuller context and fewer requests, with more delay.',
};

function interimCopy(mode: InterimMode | null): string {
  if (mode === 'rerun') {
    return "Shows Japanese while a sentence is still being spoken. This speech provider can't stream, so the text is refreshed by re-transcribing the sentence so far about once a second, and the end of a line may still change.";
  }
  if (mode === 'native') return 'Shows Japanese as the provider streams it.';
  if (mode === 'none') return 'Turned off on the server (ENABLE_PARTIALS=false). Each line appears when its sentence ends.';
  return 'Shows Japanese while a sentence is still being spoken.';
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="panel p-5">
      <h2 className="mb-1 text-base font-semibold">{title}</h2>
      <div className="divide-y">{children}</div>
    </section>
  );
}

function Field({ label, hint, children, stack }: { label: string; hint?: string; children: ReactNode; stack?: boolean }) {
  return (
    <div className={cn('flex gap-4 py-4', stack ? 'flex-col' : 'flex-wrap items-center justify-between')}>
      <div className="min-w-0 max-w-md">
        <p className="text-sm font-medium">{label}</p>
        {hint && <p className="mt-0.5 text-sm text-muted">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

export function SettingsView({ settings, update, reset, rows }: { settings: Settings; update: (p: Partial<Settings>) => void; reset: () => void; rows: OverlayRow[] }) {
  const controller = useController();
  const { health, healthState, sttInterim } = useControllerState();
  const interim = sttInterim ?? health?.stt.interim ?? null;

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-8">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Settings</h1>
      <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
        <div className="order-2 space-y-5 lg:order-1">
          <Group title="Languages">
            <Field label="Source language" hint="Auto-detect keeps Japanese speech and ignores everything else.">
              <select
                aria-label="Source language"
                value={settings.sourceLang}
                onChange={(e) => update({ sourceLang: e.target.value as Settings['sourceLang'] })}
                className="h-10 rounded-xl border bg-ink-800 px-3 text-sm"
              >
                <option value="ja">Japanese</option>
                <option value="auto">Auto-detect</option>
              </select>
            </Field>
            <Field label="Target language" hint="Subtitles are translated into Thai.">
              <span className="inline-flex h-10 items-center gap-2 rounded-xl border bg-ink-800/60 px-3 text-sm text-muted">
                <Lock size={14} /> Thai
              </span>
            </Field>
          </Group>

          <Group title="Subtitles">
            <Field label="Content" hint="What the panels, history and overlay show.">
              <Segmented
                label="Subtitle content"
                value={settings.displayMode}
                onChange={(v) => update({ displayMode: v })}
                options={[
                  { value: 'thai', label: 'Thai only' },
                  { value: 'both', label: 'Japanese + Thai' },
                  { value: 'japanese', label: 'Japanese only' },
                ]}
              />
            </Field>
            <Field label="Show Japanese original" hint="Puts the Japanese above the Thai.">
              <Switch checked={settings.displayMode !== 'thai'} onCheckedChange={(v) => update({ displayMode: v ? 'both' : 'thai' })} aria-label="Show Japanese original" />
            </Field>
            <Field label="Live Japanese text" hint={interimCopy(interim)}>
              <Switch checked={settings.showPartials && interim !== 'none'} disabled={interim === 'none'} onCheckedChange={(v) => update({ showPartials: v })} aria-label="Live Japanese text" />
            </Field>
            <Field label="Draft Thai while speaking (experimental)" hint="Shows a dimmed Thai draft before the sentence is finished. It can change as more is heard, and it uses extra translation requests.">
              <Switch checked={settings.draftTranslation} disabled={!settings.showPartials || interim === 'none'} onCheckedChange={(v) => update({ draftTranslation: v })} aria-label="Draft Thai while speaking" />
            </Field>
            <Field label="In-app overlay" hint="Floats the subtitle over this app. Use the PiP window for other tabs.">
              <Switch checked={settings.overlayEnabled} onCheckedChange={(v) => update({ overlayEnabled: v })} aria-label="In-app overlay" />
            </Field>
            <Field label={`Font size: ${settings.fontSize}px`} stack>
              <Slider label="Subtitle font size" min={20} max={72} step={2} value={[settings.fontSize]} onValueChange={([v]) => update({ fontSize: v })} />
            </Field>
            <Field label={`Visible lines: ${settings.overlayLines}`} hint="Older lines stay above the newest one. The stack also shrinks to fit the space so it never covers most of the video." stack>
              <Slider label="Visible subtitle lines" min={1} max={6} step={1} value={[settings.overlayLines]} onValueChange={([v]) => update({ overlayLines: v })} />
            </Field>
            <Field label={`Subtitle duration: ${settings.overlayDuration.toFixed(2).replace(/0$/, '')}×`} hint="How long a finished line stays. Longer lines get more time automatically; this scales it." stack>
              <Slider label="Subtitle duration" min={0.5} max={3} step={0.25} value={[settings.overlayDuration]} onValueChange={([v]) => update({ overlayDuration: v })} />
            </Field>
            <Field label="Keep subtitles longer" hint="History mode: lines stay about three times longer, so you can read back. Everything also stays in the history.">
              <Switch checked={settings.keepLonger} onCheckedChange={(v) => update({ keepLonger: v })} aria-label="Keep subtitles longer" />
            </Field>
            <Field label="Text color">
              <div className="flex items-center gap-2" role="radiogroup" aria-label="Text color">
                {SWATCHES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={settings.textColor.toLowerCase() === c}
                    aria-label={c}
                    onClick={() => update({ textColor: c })}
                    className={cn('h-7 w-7 rounded-full border-2 transition-transform hover:scale-110', settings.textColor.toLowerCase() === c ? 'border-iris' : 'border-white/15')}
                    style={{ background: c }}
                  />
                ))}
                <input type="color" aria-label="Custom text color" value={settings.textColor} onChange={(e) => update({ textColor: e.target.value })} className="h-7 w-9 cursor-pointer rounded-md border bg-transparent p-0" />
              </div>
            </Field>
            <Field label={`Background opacity: ${settings.bgOpacity}%`} stack>
              <Slider label="Subtitle background opacity" min={0} max={100} step={5} value={[settings.bgOpacity]} onValueChange={([v]) => update({ bgOpacity: v })} />
            </Field>
            <Field label="Position">
              <Segmented
                label="Subtitle position"
                value={settings.position}
                onChange={(v) => update({ position: v })}
                options={[{ value: 'top', label: 'Top' }, { value: 'center', label: 'Center' }, { value: 'bottom', label: 'Bottom' }]}
              />
            </Field>
          </Group>

          <Group title="History">
            <Field label="Auto-scroll" hint="Keep the newest subtitle in view.">
              <Switch checked={settings.autoScroll} onCheckedChange={(v) => update({ autoScroll: v })} aria-label="Auto-scroll history" />
            </Field>
          </Group>

          <Group title="Speed and accuracy">
            <Field label="Latency preference" hint={LATENCY_COPY[settings.latency]} stack>
              <Segmented
                label="Latency preference"
                value={settings.latency}
                onChange={(v) => update({ latency: v })}
                options={[{ value: 'fast', label: 'Fastest' }, { value: 'balanced', label: 'Balanced' }, { value: 'accurate', label: 'Most accurate' }]}
              />
            </Field>
            <Field label="Names and terms" hint="One per line, like 田中 = ทานากะ. Used for recognition and translation so names stay consistent." stack>
              <textarea
                aria-label="Glossary"
                value={settings.glossary}
                onChange={(e) => update({ glossary: e.target.value })}
                rows={5}
                maxLength={2000}
                placeholder={'田中 = ทานากะ\nさくら = ซากุระ'}
                className="w-full resize-y rounded-xl border bg-ink-800 px-3 py-2 text-sm leading-relaxed placeholder:text-faint"
              />
            </Field>
          </Group>

          <Group title="Services">
            <Field label="Server" hint={healthState === 'ok' ? 'Connected.' : healthState === 'offline' ? 'Not reachable. Start it with npm run dev.' : 'Checking…'}>
              <Button size="sm" onClick={() => void controller.checkHealth()}>Check again</Button>
            </Field>
            <Field label="Speech recognition" hint={health ? (health.stt.configured ? `${health.stt.model} via ${health.stt.provider}` : 'Not configured. Set STT_API_KEY in .env.') : 'Unknown until the server responds.'}>
              <span className={cn('text-sm', health?.stt.configured ? 'text-ok' : 'text-warn')}>{health ? (health.stt.configured ? 'Configured' : 'Missing key') : '-'}</span>
            </Field>
            <Field label="Live text method" hint={interim === 'rerun' ? 'Refreshed by re-transcribing the sentence so far (the speech provider does not stream).' : interim === 'native' ? 'Streamed by the provider.' : interim === 'none' ? 'Off.' : 'Unknown until the server responds.'}>
              <span className="text-sm text-muted">{interim === 'rerun' ? 'Re-transcription' : interim === 'native' ? 'Streaming' : interim === 'none' ? 'Off' : '-'}</span>
            </Field>
            <Field label="Translation" hint={health ? (health.translate.configured ? `${health.translate.model} via ${health.translate.provider}` : 'Not configured. Set LLM_API_KEY in .env.') : 'Unknown until the server responds.'}>
              <span className={cn('text-sm', health?.translate.configured ? 'text-ok' : 'text-warn')}>{health ? (health.translate.configured ? 'Configured' : 'Missing key') : '-'}</span>
            </Field>
            <Field label="Access token" hint="Only needed if the server sets ACCESS_TOKEN. API keys never leave the server." stack>
              <input
                type="password"
                autoComplete="off"
                aria-label="Access token"
                value={settings.accessToken}
                onChange={(e) => update({ accessToken: e.target.value })}
                className="h-10 w-full max-w-sm rounded-xl border bg-ink-800 px-3 text-sm"
              />
            </Field>
          </Group>

          <div className="flex justify-end">
            <Button variant="ghost" onClick={reset}>Reset appearance and behavior</Button>
          </div>
        </div>

        <aside className="order-1 lg:order-2">
          <div className="space-y-2 lg:sticky lg:top-6">
            <p className="text-sm font-medium">Live preview</p>
            <SubtitleStage rows={rows} settings={settings} sample />
            <p className="text-xs text-muted">The preview is scaled as if your screen were 1280 px wide. Use the sun button to test a bright background.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
