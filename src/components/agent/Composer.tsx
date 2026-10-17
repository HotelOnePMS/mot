'use client';

import * as React from 'react';
import { ArrowUp, Mic, Square, WifiOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { IconButton } from '@/components/ui/button';
import { Kbd } from '@/components/ui/primitives';

export const COMMAND_EXAMPLES = [
  'brief me',
  'who’s arriving today?',
  'who’s leaving today?',
  'who is in house?',
  'check in the Smiths, quiet room on a high floor',
  'check out room 201',
  'assign rooms for today’s arrivals',
  'which rooms need cleaning?',
  'auto-assign housekeeping',
  'show the housekeeping board',
  'mark 203 clean',
  'room 106 out of order — broken AC',
  'availability next weekend for 2 guests',
  'forecast the next 3 weekends',
  'occupancy this week',
  'raise weekend rates 10%',
  'what happened today?',
  'help',
];

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};

function getSpeech(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface ComposerHandle {
  focus: () => void;
  setValue: (v: string) => void;
}

export const Composer = React.forwardRef<
  ComposerHandle,
  {
    onSend: (text: string) => void;
    onStop: () => void;
    busy: boolean;
    online: boolean;
    history: string[];
    placeholder?: string;
    /** Extra control rendered next to the mic (e.g. the live voice button). */
    extra?: React.ReactNode;
    compact?: boolean;
    autoFocus?: boolean;
  }
>(function Composer({ onSend, onStop, busy, online, history, placeholder, compact, autoFocus, extra }, ref) {
  const [value, setValue] = React.useState('');
  const [historyIndex, setHistoryIndex] = React.useState<number | null>(null);
  const [highlight, setHighlight] = React.useState(0);
  const [listening, setListening] = React.useState(false);
  const [speechOk, setSpeechOk] = React.useState(false);
  const taRef = React.useRef<HTMLTextAreaElement>(null);
  const recRef = React.useRef<SpeechRecognitionLike | null>(null);

  React.useEffect(() => setSpeechOk(!!getSpeech()), []);

  React.useImperativeHandle(ref, () => ({
    focus: () => taRef.current?.focus(),
    setValue: (v: string) => {
      setValue(v);
      requestAnimationFrame(() => {
        const ta = taRef.current;
        if (!ta) return;
        ta.focus();
        ta.setSelectionRange(v.length, v.length);
      });
    },
  }));

  // Auto-grow up to ~6 lines.
  React.useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = '0px';
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }, [value]);

  const q = value.trim().toLowerCase();
  const matches = q.length >= 2 ? COMMAND_EXAMPLES.filter((c) => c.toLowerCase().includes(q) && c.toLowerCase() !== q).slice(0, 5) : [];

  function submit(text = value) {
    const t = text.trim();
    if (!t || busy) return;
    onSend(t);
    setValue('');
    setHistoryIndex(null);
    setHighlight(0);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (matches.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && historyIndex === null) {
      e.preventDefault();
      setHighlight((h) => (h + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length);
      return;
    }
    if (matches.length && e.key === 'Tab') {
      e.preventDefault();
      setValue(matches[highlight]);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
      return;
    }
    if (e.key === 'ArrowUp' && !value && history.length) {
      e.preventDefault();
      const idx = historyIndex === null ? history.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(idx);
      setValue(history[idx]);
      return;
    }
    if (e.key === 'ArrowDown' && historyIndex !== null) {
      e.preventDefault();
      const idx = historyIndex + 1;
      if (idx >= history.length) {
        setHistoryIndex(null);
        setValue('');
      } else {
        setHistoryIndex(idx);
        setValue(history[idx]);
      }
      return;
    }
    if (e.key === 'Escape') taRef.current?.blur();
  }

  function toggleMic() {
    const Speech = getSpeech();
    if (!Speech) return;
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const rec = new Speech();
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.continuous = false;
    const base = value ? value.trimEnd() + ' ' : '';
    rec.onresult = (e) => {
      const text = Array.from(e.results)
        .map((r) => r[0].transcript)
        .join('');
      setValue(base + text);
    };
    rec.onend = () => {
      setListening(false);
      taRef.current?.focus();
    };
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
  }

  const listId = React.useId();
  const hintId = React.useId();
  const showMatches = matches.length > 0;

  return (
    <div className="relative">
      {showMatches && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Suggested commands"
          className="absolute inset-x-0 bottom-full z-10 mb-2 overflow-hidden rounded-xl border bg-popover p-1 text-popover-foreground shadow-lifted animate-scale-in"
        >
          {matches.map((m, i) => (
            <li
              key={m}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === highlight}
              onMouseDown={(e) => {
                e.preventDefault();
                submit(m);
              }}
              onMouseEnter={() => setHighlight(i)}
              className={cn('flex min-h-10 cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm', i === highlight && 'bg-accent text-accent-foreground')}
            >
              <span className="min-w-0 truncate">{m}</span>
              {i === highlight && (
                <span className="hidden shrink-0 items-center gap-1 text-xs text-muted-foreground sm:inline-flex" aria-hidden>
                  <Kbd>Tab</Kbd> to fill
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <div
        className={cn(
          'group relative rounded-2xl border border-border-strong/40 bg-card shadow-lifted transition-[border-color,box-shadow] focus-within:border-agent/60 focus-within:shadow-glow',
          !online && 'border-warning/60'
        )}
      >
        <label htmlFor="agent-composer" className="sr-only">
          Message the agent
        </label>
        <textarea
          id="agent-composer"
          ref={taRef}
          rows={1}
          value={value}
          autoFocus={autoFocus}
          onChange={(e) => {
            setValue(e.target.value);
            setHistoryIndex(null);
            setHighlight(0);
          }}
          onKeyDown={onKeyDown}
          placeholder={listening ? 'Listening…' : placeholder ?? 'Ask or tell the agent what to do…'}
          aria-describedby={hintId}
          aria-controls={showMatches ? listId : undefined}
          aria-activedescendant={showMatches ? `${listId}-${highlight}` : undefined}
          aria-autocomplete="list"
          enterKeyHint="send"
          className={cn(
            'block w-full resize-none rounded-2xl bg-transparent px-4 pb-14 pt-3.5 text-base leading-relaxed placeholder:text-muted-foreground focus:outline-none md:text-[15px]',
            compact && 'md:text-sm'
          )}
        />
        <p id={hintId} className="sr-only">
          Press Enter to send and Shift+Enter for a new line. The up arrow brings back earlier commands.
        </p>
        <div className="absolute inset-x-2 bottom-2 flex items-center gap-1">
          {extra}
          {speechOk && !extra && (
            <IconButton
              type="button"
              label={listening ? 'Stop listening' : 'Speak a command'}
              aria-pressed={listening}
              onClick={toggleMic}
              className={cn('rounded-full', listening && 'bg-agent-soft text-agent-soft-foreground hover:bg-agent-soft motion-safe:animate-pulse-ring')}
            >
              <Mic aria-hidden />
            </IconButton>
          )}
          <div className="ml-1 hidden min-w-0 items-center gap-1.5 text-xs text-muted-foreground sm:flex" aria-hidden>
            {!online ? (
              <span className="inline-flex items-center gap-1.5 font-medium text-warning-soft-foreground">
                <WifiOff className="size-3.5" /> Offline
              </span>
            ) : listening ? (
              <span className="font-medium text-agent-soft-foreground">Listening… speak now</span>
            ) : (
              !compact && (
                <>
                  <Kbd>Enter</Kbd> send
                  <span className="text-border-strong">·</span>
                  <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> new line
                  <span className="hidden text-border-strong lg:inline">·</span>
                  <span className="hidden items-center gap-1.5 lg:inline-flex">
                    <Kbd>↑</Kbd> earlier
                  </span>
                </>
              )
            )}
          </div>
          <div className="ml-auto flex items-center">
            {busy ? (
              <IconButton type="button" label="Stop answering" variant="secondary" onClick={onStop} className="rounded-xl">
                <Square className="size-3.5 fill-current" aria-hidden />
              </IconButton>
            ) : (
              <IconButton
                type="button"
                label="Send"
                variant={value.trim() ? 'agent' : 'secondary'}
                onClick={() => submit()}
                disabled={!value.trim()}
                className="rounded-xl"
              >
                <ArrowUp aria-hidden />
              </IconButton>
            )}
          </div>
        </div>
      </div>
      <span className="sr-only" role="status">
        {listening ? 'Listening. Speak your command.' : ''}
      </span>
    </div>
  );
});
