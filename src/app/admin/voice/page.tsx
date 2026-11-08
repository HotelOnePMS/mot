'use client';

import * as React from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { toast } from 'sonner';
import {
  AudioLines,
  Check,
  CheckCircle2,
  CircleDashed,
  Copy,
  Globe,
  Inbox,
  Mail,
  MessageCircle,
  Mic,
  MicOff,
  Phone,
  PhoneCall,
  PhoneOff,
  Plus,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Trash2,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { api, fetcher } from '@/lib/fetcher';
import { HALF_HOURS, formatClock, formatPhone, telHref, timeAgo } from '@/lib/format';
import { formatNumber } from '@/lib/status';
import { cn } from '@/lib/utils';
import { PRODUCT_NAME, PRODUCT_SUPPORT_EMAIL } from '@/config/product';
import { Badge } from '@/components/ui/badge';
import { Button, IconButton } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Callout, EmptyState, PageHeader, Skeleton, StatTile } from '@/components/ui/primitives';
import { SegmentedControl } from '@/components/ui/segmented';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useConsole, usePropertyUrl } from '@/components/console/ConsoleProvider';
import { useLiveVoice } from '@/components/voice/useLiveVoice';
import { VoiceOrb } from '@/components/voice/VoiceOrb';
import { WelcomeBanner } from '@/components/console/WelcomeBanner';
import { DeveloperNote } from '@/components/setup/DeveloperNote';
import { SaveBar } from '@/components/setup/SaveBar';
import { PhoneLine } from './PhoneLine';

interface VoiceConfig {
  enabled: boolean;
  voice: string;
  greeting: string | null;
  instructions: string | null;
  faqs: { q: string; a: string }[];
  handoffPhone: string | null;
  guestWidget: boolean;
  checkInTime: string | null;
  checkOutTime: string | null;
  cancellationPolicy: string | null;
  notifyEmail: string | null;
}
interface VoiceOverview {
  connected: boolean;
  provider: 'openai' | 'elevenlabs';
  model: string;
  voices: string[];
  config: VoiceConfig;
  phoneLine: { enabled: boolean } | null;
  /** Phone lines run on ElevenLabs, whichever provider serves the booking page. */
  phoneReady: boolean;
  /** Email alerts can be sent (Resend is configured). */
  emailReady: boolean;
  stats: { guestCalls: number; phoneCalls: number; whatsAppChats: number; staffSessions: number; toolCalls: number; recentMinutes: number; openRequests: number };
  setup: { roomTypes: number; faqs: number; policies: boolean; testCalls: number; phoneCalls: number; notifyTo: string[] };
  recent: { id: string; audience: string; startedAt: string; endedAt: string | null; toolCalls: number }[];
}
interface GuestRequest {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  message: string;
  /** VOICE (booking page) | PHONE | WHATSAPP | AGENT (outside AI assistant) */
  source: string;
  status: 'NEW' | 'DONE';
  createdAt: string;
}

type Tab = 'overview' | 'settings' | 'phone' | 'requests';
const TAB_HASH: Record<Tab, string> = { overview: '', settings: 'settings', phone: 'phone', requests: 'messages' };

interface ModelCheck {
  model: string;
  role: string;
  ok: boolean;
  reason: string | null;
}

const FRAME = 'mx-auto w-full max-w-7xl px-4 pb-12 pt-5 sm:px-6 sm:pt-6 lg:px-8 lg:pt-8';

/** Try the guest line from the console: same voice, prompts and tools guests get. */
function TestCall({ propertyId, connected, showModels, voiceOnly }: { propertyId: string; connected: boolean; showModels: boolean; voiceOnly: boolean }) {
  const voice = useLiveVoice({
    propertyId,
    audience: 'guest',
    onToolCall: async (call, { token }) => {
      const res = await fetch('/api/voice/tool', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, name: call.name, arguments: call.arguments }) });
      const body = await res.json().catch(() => ({}));
      return res.ok ? body.output : { error: body.error ?? 'Lookup failed' };
    },
  });
  const live = voice.state === 'live' || voice.state === 'connecting';
  const agentLine = [...voice.captions].reverse().find((c) => c.role === 'agent')?.text;
  const [check, setCheck] = React.useState<{ provider: string; models: ModelCheck[] } | null>(null);
  const [checking, setChecking] = React.useState(false);
  async function runCheck() {
    setChecking(true);
    try {
      const res = await api<{ provider: string; key: boolean; models: ModelCheck[] }>('/api/admin/voice/check');
      setCheck({ provider: res.provider, models: res.models });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setChecking(false);
    }
  }
  return (
    <Card className="relative overflow-hidden p-5 sm:p-6">
      <div className="bg-aurora pointer-events-none absolute inset-0 opacity-[0.06]" aria-hidden />
      <div className="relative flex flex-col items-center gap-5 text-center sm:flex-row sm:text-left">
        <VoiceOrb state={voice.state} level={voice.level} speaking={voice.agentSpeaking} working={voice.working} size={72} />
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold tracking-tight">Hear what your guests hear</h2>
          <p className="mt-1 text-sm text-muted-foreground" aria-live="polite">
            {voice.error ? (
              <span className="text-destructive">{voice.error}</span>
            ) : live ? (
              agentLine ?? 'Listening. Ask about a room for next weekend.'
            ) : (
              voiceOnly
                ? 'Start a test call with your voice front desk. It answers like it does on your phone line, with your prices and settings.'
                : 'Start a test call with your voice front desk. It uses live availability and your settings.'
            )}
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          {live ? (
            <>
              <IconButton label={voice.muted ? 'Unmute' : 'Mute'} variant="outline" size="icon" onClick={voice.toggleMute} aria-pressed={voice.muted}>
                {voice.muted ? <MicOff /> : <Mic />}
              </IconButton>
              <Button variant="destructive" onClick={voice.stop}>
                <PhoneOff aria-hidden /> End call
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => void runCheck()} disabled={!connected} loading={checking} loadingText="Checking the connection…">
                <ShieldCheck aria-hidden /> {checking ? 'Checking…' : 'Check connection'}
              </Button>
              <Button variant="agent" onClick={() => void voice.start()} disabled={!connected}>
                <PhoneCall aria-hidden /> Test call
              </Button>
            </>
          )}
        </div>
      </div>
      {check && (
        <ul className="relative mt-5 space-y-2.5 border-t pt-4 text-sm" aria-live="polite">
          {check.models.map((m) => (
            <li key={m.model} className="flex items-start gap-2.5">
              {m.ok ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
              ) : (
                <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
              )}
              <span className="min-w-0">
                <span className="font-medium">{m.role}</span>
                <span className="sr-only">{m.ok ? ': working.' : ': not working.'}</span>
                {showModels && <code className="ml-1.5 rounded-sm bg-muted px-1 py-px font-mono text-xs">{m.model}</code>}
                <span className="block text-muted-foreground">{m.ok ? (check.provider === 'elevenlabs' ? 'Connected and in sync.' : 'Available and ready.') : m.reason}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * Voice-only hotels: the few things between signing up and the phone being
 * answered, in order, each with where to do it. Ticks come from real use
 * (a test call made, a first call answered), not from clicks.
 */
function GoLive({ data, onTab }: { data: VoiceOverview; onTab: (t: Tab) => void }) {
  const s = data.setup;
  const steps: { title: string; text: string; done: boolean; cta: string; href?: string; tab?: Tab }[] = [
    {
      title: 'Rooms and prices',
      text: s.roomTypes ? `${s.roomTypes} room type${s.roomTypes > 1 ? 's' : ''} for the voice to quote. Set different prices for busy nights under Rates.` : 'Add your room types and nightly prices. The voice quotes them.',
      done: s.roomTypes > 0,
      cta: s.roomTypes ? 'Check rooms' : 'Add rooms',
      href: '/admin/room-types',
    },
    {
      title: 'Policies and common questions',
      text: s.faqs ? `${s.faqs} answer${s.faqs > 1 ? 's' : ''} so far. Parking, breakfast, pets and early check-in are the usual ones.` : 'Add answers to the questions callers ask most: parking, breakfast, pets, early check-in.',
      done: s.policies && s.faqs > 0,
      cta: 'Open Settings',
      tab: 'settings',
    },
    {
      title: 'Hear it yourself',
      text: s.testCalls ? 'You’ve talked to it. Try again after changing Settings. New calls use them straight away.' : 'Press Test call above and ask for a room next weekend, like a guest would.',
      done: s.testCalls > 0,
      cta: 'Test call',
    },
    {
      title: 'Connect your phone number',
      text: s.phoneCalls ? 'Calls are coming in on your line.' : 'Connect a Twilio number, then forward your hotel line to it for calls you can’t pick up.',
      done: s.phoneCalls > 0,
      cta: 'Set up the line',
      tab: 'phone',
    },
  ];
  const done = steps.filter((x) => x.done).length;
  if (done === steps.length) return null;
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold tracking-tight">Go live</h2>
        <p className="text-sm text-muted-foreground">
          {done} of {steps.length} done
        </p>
      </div>
      <ol className="mt-4 space-y-2.5">
        {steps.map((step, i) => (
          <li key={step.title} className="flex flex-col gap-3 rounded-xl border px-4 py-3 sm:flex-row sm:items-center">
            <span
              className={cn(
                'flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular',
                step.done ? 'bg-success-soft text-success-soft-foreground' : 'border border-border-strong/60 text-foreground'
              )}
              aria-hidden
            >
              {step.done ? <Check className="size-4" /> : i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                <span className="sr-only">{step.done ? 'Done: ' : 'To do: '}</span>
                {step.title}
              </p>
              <p className="text-sm text-muted-foreground">{step.text}</p>
            </div>
            {!step.done &&
              (step.href ? (
                <Button asChild variant="outline" size="sm" className="self-start sm:self-center">
                  <Link href={step.href}>{step.cta}</Link>
                </Button>
              ) : step.tab ? (
                <Button variant="outline" size="sm" className="self-start sm:self-center" onClick={() => onTab(step.tab!)}>
                  {step.cta}
                </Button>
              ) : null)}
          </li>
        ))}
      </ol>
      <p className="mt-4 text-sm text-muted-foreground">
        {s.notifyTo.length ? (
          <>
            Messages and booking requests from callers land in Messages{data.emailReady ? <> and are emailed to {s.notifyTo.join(', ')}</> : null}.
          </>
        ) : (
          'Messages and booking requests from callers land in Messages.'
        )}
      </p>
    </Card>
  );
}

function SwitchRow({ id, title, text, checked, onChange }: { id: string; title: string; text: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4 p-5">
      <div className="min-w-0">
        <p id={`${id}-label`} className="text-sm font-medium">
          {title}
        </p>
        <p id={`${id}-desc`} className="mt-0.5 text-sm text-muted-foreground">
          {text}
        </p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-labelledby={`${id}-label`} aria-describedby={`${id}-desc`} />
    </div>
  );
}

function Settings({ data, onSaved }: { data: VoiceOverview; onSaved: () => void }) {
  const { propertyId, property, can, role } = useConsole();
  const setupPath = property?.setupPath ?? 'FULL';
  const [cfg, setCfg] = React.useState<VoiceConfig>(data.config);
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => setCfg(data.config), [data.config]);
  const editable = can('voice.manage');
  const dirty = JSON.stringify(cfg) !== JSON.stringify(data.config);
  const set = <K extends keyof VoiceConfig>(k: K, v: VoiceConfig[K]) => setCfg((c) => ({ ...c, [k]: v }));
  const faqRefs = React.useRef<(HTMLTextAreaElement | null)[]>([]);

  async function save() {
    setSaving(true);
    try {
      await api('/api/admin/voice', {
        method: 'PUT',
        json: { propertyId, ...cfg, faqs: cfg.faqs.filter((f) => f.q.trim() && f.a.trim()) },
      });
      toast.success('Voice settings saved. New calls use them right away');
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function addFaq() {
    set('faqs', [...cfg.faqs, { q: '', a: '' }]);
    // Put the cursor in the new question.
    requestAnimationFrame(() => faqRefs.current[cfg.faqs.length]?.focus());
  }

  return (
    <div className="space-y-6">
      {!editable && (
        <Callout tone="neutral" title="View only">
          Only the owner or a manager can change how the voice front desk sounds and answers.
        </Callout>
      )}
      <fieldset disabled={!editable} className="space-y-6">
        <legend className="sr-only">Voice front desk settings</legend>
        <Card className="divide-y p-0">
          <SwitchRow
            id="v-enabled"
            title="Voice front desk"
            text={
              setupPath === 'VOICE'
                ? 'Answer callers with your prices and policies, and take booking requests and messages for your team.'
                : 'Answer guest questions by voice with live availability and prices, on your booking page and your phone line.'
            }
            checked={cfg.enabled}
            onChange={(v) => set('enabled', v)}
          />
          {/* Voice-only hotels have no booking page to put it on. */}
          {setupPath !== 'VOICE' && (
            <SwitchRow
              id="v-widget"
              title="“Talk to us” on your booking page"
              text="Guests can start a voice conversation right from your hotel page."
              checked={cfg.guestWidget}
              onChange={(v) => set('guestWidget', v)}
            />
          )}
        </Card>

        {setupPath !== 'FULL' && (
          <Card className="space-y-5 p-5 sm:p-6">
            <div>
              <h2 className="text-base font-semibold tracking-tight">Your policies</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">What the voice tells callers. Anything left blank, it offers to take a message about instead of guessing.</p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:max-w-md">
              <Field label="Check-in from">
                <Select value={cfg.checkInTime ?? ''} onValueChange={(v) => set('checkInTime', v || null)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Not set" />
                  </SelectTrigger>
                  <SelectContent>
                    {HALF_HOURS.map((t) => (
                      <SelectItem key={t} value={t}>
                        {formatClock(t)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Check-out by">
                <Select value={cfg.checkOutTime ?? ''} onValueChange={(v) => set('checkOutTime', v || null)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Not set" />
                  </SelectTrigger>
                  <SelectContent>
                    {HALF_HOURS.map((t) => (
                      <SelectItem key={t} value={t}>
                        {formatClock(t)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field label="Cancellation policy" optional>
              <Textarea
                rows={2}
                value={cfg.cancellationPolicy ?? ''}
                onChange={(e) => set('cancellationPolicy', e.target.value)}
                placeholder="Free cancellation until 24 hours before arrival. After that, the first night is charged."
                maxLength={500}
              />
            </Field>
          </Card>
        )}

        <Card className="space-y-5 p-5 sm:p-6">
          <div>
            <h2 className="text-base font-semibold tracking-tight">Messages and booking requests</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">Each one lands in Messages{data.emailReady ? ' and is emailed to you right away' : ''}.</p>
          </div>
          <Field
            label="Email them to"
            optional
            hint={
              data.emailReady
                ? 'Separate several addresses with commas. Left blank, they go to the hotel’s owners.'
                : `Email alerts start once ${PRODUCT_NAME} email is switched on for this site. Until then, check Messages.`
            }
          >
            <Input type="text" inputMode="email" autoComplete="email" spellCheck={false} value={cfg.notifyEmail ?? ''} onChange={(e) => set('notifyEmail', e.target.value)} placeholder="frontdesk@yourhotel.com" maxLength={500} />
          </Field>
        </Card>

        <Card className="space-y-5 p-5 sm:p-6">
          <h2 className="text-base font-semibold tracking-tight">How it sounds</h2>
          <div className="grid gap-5 sm:grid-cols-2">
            {data.provider === 'elevenlabs' ? (
              <div className="grid content-start gap-2">
                <p className="text-sm font-medium leading-5">Voice</p>
                <p className="flex min-h-10 items-center gap-2 rounded-lg border bg-surface-sunken px-3 text-sm text-muted-foreground">
                  <AudioLines className="size-4" aria-hidden /> Chosen for you by {PRODUCT_NAME}
                </p>
                <DeveloperNote open={role === 'ADMIN'}>
                  <p>
                    Set <code>ELEVENLABS_VOICE_ID</code> to any voice from your ElevenLabs library to change it.
                  </p>
                </DeveloperNote>
              </div>
            ) : (
              <Field label="Voice">
                <Select value={cfg.voice} onValueChange={(v) => set('voice', v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {data.voices.map((v) => (
                      <SelectItem key={v} value={v}>
                        {v[0].toUpperCase() + v.slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
            <Field label="Hand-off phone number" optional hint="Given out when a caller wants a person. Include the country code, like +1 831 555 0100.">
              <Input type="tel" inputMode="tel" autoComplete="tel" value={cfg.handoffPhone ?? ''} onChange={(e) => set('handoffPhone', e.target.value)} placeholder="+1 831 555 0100" />
            </Field>
          </div>
          <Field label="Greeting" hint="The first thing callers hear.">
            <Textarea
              rows={1}
              className="min-h-10 resize-none [field-sizing:content]"
              value={cfg.greeting ?? ''}
              onChange={(e) => set('greeting', e.target.value.replace(/\n/g, ' '))}
              onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
              placeholder="Thanks for calling the Saltwater Inn, how can I help?"
              maxLength={300}
            />
          </Field>
          <Field label="House rules" hint="Anything the voice should always do or never say. It still can’t invent prices or availability.">
            <Textarea
              rows={4}
              value={cfg.instructions ?? ''}
              onChange={(e) => set('instructions', e.target.value)}
              placeholder={'Always mention free breakfast.\nPets: dogs under 30 lb, $25 per night.\nWe don’t do day-use rooms.'}
              maxLength={4000}
            />
          </Field>
        </Card>

        <Card className="p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-semibold tracking-tight">Answers to common questions</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">Parking, breakfast, pets, early check-in: the voice quotes these word for word.</p>
            </div>
            <Button variant="outline" size="sm" onClick={addFaq} disabled={cfg.faqs.length >= 40}>
              <Plus aria-hidden /> Add a question
            </Button>
          </div>
          <div className="mt-4 space-y-3">
            {cfg.faqs.length === 0 && (
              <div className="rounded-xl border border-dashed px-4 py-8 text-center">
                <p className="text-sm font-medium">No answers yet</p>
                <p className="mt-1 text-sm text-muted-foreground">Add your top three questions to start. Parking, breakfast and check-in times are the usual ones.</p>
              </div>
            )}
            {cfg.faqs.map((f, i) => (
              <div key={i} className="grid gap-3 rounded-xl border bg-surface-sunken/40 p-3 sm:grid-cols-[1fr_1.4fr_auto] sm:items-start sm:p-4">
                <Field label={`Question ${i + 1}`} labelClassName="text-xs text-muted-foreground">
                  <Textarea
                    ref={(el) => {
                      faqRefs.current[i] = el;
                    }}
                    rows={1}
                    className="min-h-10 resize-none [field-sizing:content]"
                    value={f.q}
                    onChange={(e) => set('faqs', cfg.faqs.map((x, j) => (j === i ? { ...x, q: e.target.value } : x)))}
                    placeholder="Is parking free?"
                  />
                </Field>
                <Field label={`Answer ${i + 1}`} labelClassName="text-xs text-muted-foreground">
                  <Textarea
                    rows={1}
                    className="min-h-10 resize-none [field-sizing:content]"
                    value={f.a}
                    onChange={(e) => set('faqs', cfg.faqs.map((x, j) => (j === i ? { ...x, a: e.target.value } : x)))}
                    placeholder="Yes, free on-site parking for every guest."
                  />
                </Field>
                <IconButton label={`Remove question ${i + 1}`} className="justify-self-end text-muted-foreground hover:text-destructive sm:mt-7" onClick={() => set('faqs', cfg.faqs.filter((_, j) => j !== i))}>
                  <Trash2 />
                </IconButton>
              </div>
            ))}
          </div>
        </Card>
      </fieldset>

      {editable && <SaveBar dirty={dirty} saving={saving} onSave={() => void save()} onDiscard={() => setCfg(data.config)} saveLabel="Save settings" />}
    </div>
  );
}

/**
 * Phone booking requests end with the pre-filled checkout link for the guest.
 * Only the path is kept (the last match, which HotelOne wrote — a caller's notes
 * come before it), so copying always gives a link to this site.
 */
function bookingLink(message: string): { text: string; path: string | null } {
  const matches = [...message.matchAll(/(?:https?:\/\/\S+?)?(\/properties\/[\w-]+\/book\?\S+)$/g)];
  const last = matches.at(-1);
  if (!last) return { text: message, path: null };
  return { text: message.slice(0, last.index).replace(/:\s*$/, '.').trim(), path: last[1] };
}

const SOURCE: Record<string, { label: string; icon: LucideIcon }> = {
  PHONE: { label: 'Phone call', icon: Phone },
  WHATSAPP: { label: 'WhatsApp', icon: MessageCircle },
  VOICE: { label: 'Booking page', icon: Globe },
  // Outside AI assistants (agent API / MCP) asking on a guest's behalf.
  AGENT: { label: 'AI assistant', icon: Sparkles },
};

function Requests({ voiceOnly }: { voiceOnly: boolean }) {
  const url = usePropertyUrl('/api/admin/voice/requests');
  const { data, mutate, isLoading } = useSWR<GuestRequest[]>(url, fetcher, { refreshInterval: 30_000 });
  const [show, setShow] = React.useState<'NEW' | 'DONE'>('NEW');
  const [marking, setMarking] = React.useState<string | null>(null);
  async function mark(r: GuestRequest, status: 'NEW' | 'DONE') {
    setMarking(r.id);
    try {
      await api(`/api/admin/voice/requests/${r.id}`, { method: 'PATCH', json: { status } });
      await mutate();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setMarking(null);
    }
  }
  if (isLoading) {
    return (
      <Card className="divide-y p-0" aria-busy>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="space-y-2 p-4 sm:p-5">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-4 w-full max-w-lg" />
            <Skeleton className="h-3 w-40" />
          </div>
        ))}
      </Card>
    );
  }
  if (!data?.length) {
    return (
      <Card>
        <EmptyState icon={Inbox} title="No messages yet" description="When a caller needs something the voice can’t do, it takes a message and it lands here." />
      </Card>
    );
  }
  const open = data.filter((r) => r.status === 'NEW');
  const done = data.filter((r) => r.status === 'DONE');
  const list = show === 'NEW' ? open : done;

  return (
    <div className="space-y-4">
      <SegmentedControl
        layoutId="voice-messages"
        aria-label="Which messages"
        size="sm"
        value={show}
        onChange={setShow}
        options={[
          { value: 'NEW', label: `To handle · ${formatNumber(open.length)}` },
          { value: 'DONE', label: `Done · ${formatNumber(done.length)}` },
        ]}
      />
      {list.length === 0 ? (
        <Card>
          <EmptyState
            icon={show === 'NEW' ? CheckCircle2 : Inbox}
            title={show === 'NEW' ? 'You’re all caught up' : 'Nothing marked done yet'}
            description={show === 'NEW' ? 'New messages from callers appear here. We check every 30 seconds.' : 'Messages you mark as done move here, in case you need them again.'}
          />
        </Card>
      ) : (
        <Card className="divide-y p-0">
          {list.map((r) => {
            const link = bookingLink(r.message);
            // Voice-only hotels have no booking page: their web conversations are test calls.
            const src = r.source === 'VOICE' && voiceOnly ? { label: 'Test call', icon: PhoneCall } : (SOURCE[r.source] ?? SOURCE.VOICE);
            return (
              <article key={r.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:p-5" aria-labelledby={`req-${r.id}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <h3 id={`req-${r.id}`} className="text-sm font-semibold">
                      {r.name}
                    </h3>
                    <Badge variant="outline" size="sm" icon={src.icon} className="text-muted-foreground">
                      {src.label}
                    </Badge>
                    <time className="text-xs text-muted-foreground" dateTime={r.createdAt} title={new Date(r.createdAt).toLocaleString()}>
                      {timeAgo(r.createdAt)}
                    </time>
                  </div>
                  <p className={cn('mt-1.5 text-sm leading-relaxed', r.status === 'DONE' && 'text-muted-foreground')}>{link.text}</p>
                  <div className="-ml-2 mt-1.5 flex flex-wrap items-center gap-x-1 gap-y-1 text-sm">
                    {r.phone && (
                      <Button asChild variant="ghost" size="sm" className="px-2 text-primary">
                        <a href={telHref(r.phone)}>
                          <Phone aria-hidden /> <span className="tabular">{formatPhone(r.phone)}</span>
                        </a>
                      </Button>
                    )}
                    {r.email && (
                      <Button asChild variant="ghost" size="sm" className="max-w-full px-2 text-primary">
                        <a href={`mailto:${r.email}`}>
                          <Mail aria-hidden /> <span className="truncate">{r.email}</span>
                        </a>
                      </Button>
                    )}
                    {link.path && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="px-2 text-primary"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(new URL(link.path!, window.location.origin).toString());
                            toast.success('Booking link copied. Send it to the guest');
                          } catch {
                            toast.error('Couldn’t copy the link');
                          }
                        }}
                      >
                        <Copy aria-hidden /> Copy booking link
                      </Button>
                    )}
                  </div>
                </div>
                {r.status === 'NEW' ? (
                  <Button size="sm" variant="secondary" className="self-start" onClick={() => mark(r, 'DONE')} loading={marking === r.id}>
                    <Check aria-hidden /> Mark done
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" className="self-start" onClick={() => mark(r, 'NEW')} loading={marking === r.id}>
                    <RotateCcw aria-hidden /> Reopen
                  </Button>
                )}
              </article>
            );
          })}
        </Card>
      )}
    </div>
  );
}

export default function VoicePage() {
  const { propertyId, property, role } = useConsole();
  const url = usePropertyUrl('/api/admin/voice');
  const { data, mutate } = useSWR<VoiceOverview>(url, fetcher);
  const [tab, setTabState] = React.useState<Tab>('overview');
  const isAdmin = role === 'ADMIN';
  const voiceOnly = property?.setupPath === 'VOICE';

  // The tab lives in the URL hash (#settings, #phone, #messages) so it can be linked to.
  React.useEffect(() => {
    const sync = () => {
      const h = window.location.hash.slice(1);
      const match = (Object.keys(TAB_HASH) as Tab[]).find((t) => TAB_HASH[t] === h);
      setTabState(match ?? 'overview');
    };
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);
  const setTab = React.useCallback((t: Tab) => {
    setTabState(t);
    try {
      window.history.replaceState(null, '', TAB_HASH[t] ? `#${TAB_HASH[t]}` : window.location.pathname + window.location.search);
    } catch {
      /* history may be unavailable in embedded previews */
    }
  }, []);

  const phoneText = !data
    ? ''
    : !data.phoneReady
      ? 'Answer your hotel number and WhatsApp with this voice.'
      : !data.phoneLine
        ? 'Answer your hotel number with this voice, and WhatsApp too. Keep your number and forward the calls you miss.'
        : data.phoneLine.enabled && data.config.enabled
          ? 'On. It answers every phone and WhatsApp number you point at this hotel’s agent.'
          : 'Paused. Callers hear a short “not available” message.';

  return (
    <div className={FRAME}>
      <div className="space-y-6">
        <PageHeader
          title="Voice front desk"
          description={property ? `The voice that answers for ${property.name}, ${voiceOnly ? 'on your phone line' : 'on your booking page and your phone line'}.` : undefined}
          actions={
            <SegmentedControl
              layoutId="voice-tab"
              aria-label="Voice sections"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'overview', label: 'Overview' },
                { value: 'settings', label: 'Settings' },
                { value: 'phone', label: 'Phone & WhatsApp' },
                { value: 'requests', label: `Messages${data?.stats.openRequests ? ` · ${data.stats.openRequests}` : ''}` },
              ]}
              className="max-w-full"
            />
          }
        />

        <WelcomeBanner title="Your voice front desk is set up">
          {voiceOnly
            ? 'Press Test call to hear it, add the questions callers ask most under Settings, then connect your phone number. The checklist below keeps track.'
            : 'Add your top questions under Settings, check your rooms and prices under Rooms and Rates, then press Test call to hear it.'}
        </WelcomeBanner>

        {!data || !propertyId ? (
          <div className="space-y-6" aria-busy>
            <Skeleton className="h-[120px] rounded-2xl" />
            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-[104px] rounded-2xl" />
              ))}
            </div>
            <span className="sr-only" role="status">
              Loading voice front desk…
            </span>
          </div>
        ) : (
          <>
            {!data.connected && (
              <Callout tone="warning" title="Connect a voice service to go live">
                <p>
                  Your settings, messages and phone setup all work now. Guests start hearing your voice front desk once a voice service is connected to {PRODUCT_NAME}.
                  {!isAdmin && (
                    <>
                      {' '}
                      Ask your {PRODUCT_NAME} contact, or write to{' '}
                      <a className="font-medium underline underline-offset-2" href={`mailto:${PRODUCT_SUPPORT_EMAIL}`}>
                        {PRODUCT_SUPPORT_EMAIL}
                      </a>
                      .
                    </>
                  )}
                </p>
                <DeveloperNote open={isAdmin} className="mt-3">
                  <p>
                    Add <code>ELEVENLABS_API_KEY</code> (or <code>OPENAI_API_KEY</code>) to the server environment and redeploy.
                  </p>
                </DeveloperNote>
              </Callout>
            )}

            {tab === 'overview' && (
              <div className="space-y-6">
                <TestCall propertyId={propertyId} connected={data.connected} showModels={isAdmin} voiceOnly={voiceOnly} />
                {voiceOnly && <GoLive data={data} onTab={setTab} />}
                <section aria-label="Last 7 days" className={cn('grid grid-cols-2 gap-3 sm:gap-4', voiceOnly ? 'lg:grid-cols-3' : 'lg:grid-cols-4')}>
                  <StatTile
                    label="Guest conversations"
                    value={formatNumber(data.stats.guestCalls)}
                    hint={
                      // Allowed to wrap: the channel split matters more than a tidy single line.
                      <span className="whitespace-normal">
                        {[data.stats.phoneCalls ? `${formatNumber(data.stats.phoneCalls)} by phone` : '', data.stats.whatsAppChats ? `${formatNumber(data.stats.whatsAppChats)} on WhatsApp` : '']
                          .filter(Boolean)
                          .join(' · ') || 'Last 7 days'}
                      </span>
                    }
                    icon={AudioLines}
                  />
                  {!voiceOnly && <StatTile label="Staff voice sessions" value={formatNumber(data.stats.staffSessions)} hint="Last 7 days" icon={Mic} />}
                  <StatTile label="Lookups and actions" value={formatNumber(data.stats.toolCalls)} hint="From live data" icon={ShieldCheck} />
                  <StatTile
                    label="Messages to handle"
                    value={formatNumber(data.stats.openRequests)}
                    hint={data.stats.openRequests ? 'Open the list' : 'All caught up'}
                    icon={Inbox}
                    tone={data.stats.openRequests ? 'warning' : 'neutral'}
                    onClick={() => setTab('requests')}
                  />
                </section>
                <section aria-labelledby="voice-where" className="space-y-3">
                  <h2 id="voice-where" className="text-base font-semibold tracking-tight">
                    Where guests reach it
                  </h2>
                  <div className="grid gap-4 md:grid-cols-3">
                    {[
                      {
                        icon: Globe,
                        title: 'Booking page',
                        text: !(data.config.guestWidget && data.config.enabled)
                          ? 'Off. Turn it on in Settings.'
                          : data.connected
                            ? 'Live. Guests see “Talk to us”.'
                            : 'Switched on. It appears for guests once a voice service is connected.',
                        ok: data.config.guestWidget && data.config.enabled && data.connected,
                        onClick: !(data.config.guestWidget && data.config.enabled) ? () => setTab('settings') : undefined,
                        cta: 'Open Settings',
                      },
                      { icon: Mic, title: 'Staff hands-free', text: 'Press Talk in the Agent workspace. Changes still need your “yes”.', ok: data.connected, href: '/admin/agent', cta: 'Open the agent' },
                      {
                        icon: PhoneCall,
                        title: 'Phone & WhatsApp',
                        text: phoneText,
                        ok: data.phoneReady && !!data.phoneLine?.enabled && data.config.enabled,
                        onClick: () => setTab('phone'),
                        cta: data.phoneLine ? 'Manage the line' : 'Set it up',
                      },
                    ]
                      // Voice-only hotels have no booking page or staff agent: just the phone.
                      .filter((c) => !voiceOnly || c.title === 'Phone & WhatsApp')
                      .map((c) => (
                      <Card key={c.title} className="flex flex-col p-5 shadow-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex size-9 items-center justify-center rounded-xl bg-muted text-muted-foreground" aria-hidden>
                            <c.icon className="size-[18px]" />
                          </span>
                          {c.ok ? (
                            <Badge variant="success" size="sm" icon={CheckCircle2}>
                              Ready
                            </Badge>
                          ) : (
                            <Badge variant="neutral" size="sm" icon={CircleDashed}>
                              Not ready
                            </Badge>
                          )}
                        </div>
                        <h3 className="mt-3 text-sm font-semibold">{c.title}</h3>
                        <p className="mt-1 flex-1 text-sm text-muted-foreground">{c.text}</p>
                        {c.href ? (
                          <Button asChild variant="link" className="mt-3 self-start">
                            <Link href={c.href}>{c.cta}</Link>
                          </Button>
                        ) : c.onClick ? (
                          <Button variant="link" className="mt-3 self-start" onClick={c.onClick}>
                            {c.cta}
                          </Button>
                        ) : null}
                      </Card>
                    ))}
                  </div>
                </section>
              </div>
            )}
            {tab === 'settings' && <Settings data={data} onSaved={() => void mutate()} />}
            {tab === 'phone' && <PhoneLine key={propertyId} onChanged={() => void mutate()} onOpenSettings={() => setTab('settings')} />}
            {tab === 'requests' && <Requests voiceOnly={voiceOnly} />}
          </>
        )}
      </div>
    </div>
  );
}
