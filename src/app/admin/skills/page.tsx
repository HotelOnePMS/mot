'use client';

import * as React from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { toast } from 'sonner';
import { ArrowUpRight, BookOpenText, Cable, ChevronDown, Lightbulb, MessageSquareText, Pencil, Plus, Settings2, Sparkles, Trash2, Zap, type LucideIcon } from 'lucide-react';
import type { SkillView, SkillsResponse } from '@/lib/dto';
import { api, fetcher } from '@/lib/fetcher';
import { timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Callout, IconTile, Skeleton } from '@/components/ui/primitives';
import { PageShell, SectionHeader } from '@/components/console/PageShell';
import { useConsole, usePropertyUrl } from '@/components/console/ConsoleProvider';
import { ConfirmDialog } from '@/components/frontdesk/dialogs';
import { AnswerDialog, StepsDialog, type AnswerDraft, type StepsDraft } from './SkillDialogs';

const AUDIENCE_LABEL: Record<SkillView['audience'], string> = { GUEST: 'Guests', ALL: 'Guests & staff', STAFF: 'Staff only' };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function usedLine(s: SkillView): string {
  if (!s.uses) return 'Not used yet';
  return `Used ${plural(s.uses, 'time')}${s.lastUsedAt ? ` · last ${timeAgo(s.lastUsedAt)}` : ''}`;
}

type Actions = {
  canManage: boolean;
  guestLocked: boolean;
  busyId: string | null;
  toggle: (s: SkillView, on: boolean) => void;
  edit: (s: SkillView) => void;
  remove: (s: SkillView) => void;
};

/** Whether this person can switch/edit this skill here. */
function editable(s: SkillView, a: Actions): boolean {
  if (!a.canManage) return false;
  return !(a.guestLocked && s.kind === 'ANSWER' && s.audience !== 'STAFF');
}

/** On/off for people who can change it; a plain badge for everyone else. */
function OnOff({ s, a }: { s: SkillView; a: Actions }) {
  const on = s.status === 'ACTIVE';
  if (!a.canManage) {
    return (
      <Badge variant={on ? 'success' : 'neutral'} size="sm" dot>
        {on ? 'On' : 'Off'}
      </Badge>
    );
  }
  return (
    <Switch
      checked={on}
      disabled={!editable(s, a) || a.busyId === s.id}
      onCheckedChange={(v) => a.toggle(s, v)}
      aria-label={`Agents use “${s.title}”`}
      title={!editable(s, a) ? 'Guest answers stay as they are in the demo' : undefined}
    />
  );
}

function RowShell({ s, children, aside }: { s: SkillView; children: React.ReactNode; aside: React.ReactNode }) {
  const off = s.status === 'DISABLED';
  return (
    <li className={cn('flex gap-4 px-4 py-4 sm:px-5', off && 'bg-surface-sunken/40')}>
      <div className={cn('min-w-0 flex-1', off && '[&_.skill-body]:text-muted-foreground')}>{children}</div>
      <div className="flex shrink-0 flex-col items-end gap-2 pt-0.5">{aside}</div>
    </li>
  );
}

function RowTools({ s, a, canDelete = true, editLabel = 'Edit' }: { s: SkillView; a: Actions; canDelete?: boolean; editLabel?: string }) {
  if (!editable(s, a)) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <Button type="button" variant="outline" size="sm" onClick={() => a.edit(s)}>
        <Pencil aria-hidden /> {editLabel}
        <span className="sr-only"> “{s.title}”</span>
      </Button>
      {canDelete && (
        <Button type="button" variant="ghost" size="sm" className="text-destructive hover:bg-destructive-soft hover:text-destructive-soft-foreground" onClick={() => a.remove(s)}>
          <Trash2 aria-hidden /> Delete
          <span className="sr-only"> “{s.title}”</span>
        </Button>
      )}
    </div>
  );
}

function Steps({ steps, ordered = true }: { steps: string[]; ordered?: boolean }) {
  const List = ordered && steps.length > 1 ? 'ol' : 'ul';
  return (
    <List className="skill-body mt-2 space-y-1.5">
      {steps.map((step, i) => (
        <li key={i} className="flex gap-2.5 text-sm text-foreground">
          {List === 'ol' && <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-2xs font-semibold tabular text-muted-foreground">{i + 1}</span>}
          <code className="min-w-0 break-words rounded-sm bg-surface-sunken px-1.5 py-0.5 font-mono text-[13px] leading-5 [overflow-wrap:anywhere]">{step}</code>
        </li>
      ))}
    </List>
  );
}

/** A saved answer (from settings or added by someone). */
function AnswerRow({ s, a }: { s: SkillView; a: Actions }) {
  return (
    <RowShell s={s} aside={<OnOff s={s} a={a} />}>
      <p className="font-medium leading-snug">{s.title}</p>
      <p className="skill-body mt-1 whitespace-pre-line text-sm leading-relaxed text-foreground/90 line-clamp-4">{s.answer}</p>
      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <Badge variant={s.audience === 'STAFF' ? 'neutral' : 'info'} size="sm">
          {AUDIENCE_LABEL[s.audience]}
        </Badge>
        <span>{usedLine(s)}</span>
        {s.status === 'DISABLED' && <span>Off — agents won’t use it</span>}
        {s.editIn && (
          <Link href={s.editIn.href} className="inline-flex min-h-6 items-center gap-1 font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {s.editIn.label}
            <ArrowUpRight className="size-3" aria-hidden />
          </Link>
        )}
        {s.source === 'CONFIG' && !s.editIn && <span>Standard {s.key === 'policies' ? 'policy' : 'answer'}</span>}
      </p>
      {s.source === 'MANUAL' && <RowTools s={s} a={a} />}
    </RowShell>
  );
}

/** A shortcut staff run in the agent. */
function ShortcutRow({ s, a }: { s: SkillView; a: Actions }) {
  return (
    <RowShell s={s} aside={<OnOff s={s} a={a} />}>
      <p className="font-medium leading-snug">{s.title}</p>
      {s.example && (
        <p className="skill-body mt-0.5 text-sm text-muted-foreground">
          Say “<span className="text-foreground">{s.example}</span>”
        </p>
      )}
      <Steps steps={s.steps ?? []} />
      <p className="mt-2 text-xs text-muted-foreground">
        {usedLine(s)}
        {s.createdBy ? ` · saved by ${s.createdBy}` : ''}
      </p>
      <RowTools s={s} a={a} />
    </RowShell>
  );
}

/** Steps the PMS operator learned. */
function RecipeRow({ s, a }: { s: SkillView; a: Actions }) {
  const [open, setOpen] = React.useState(false);
  const id = React.useId();
  const steps = s.steps ?? [];
  return (
    <RowShell s={s} aside={<OnOff s={s} a={a} />}>
      <p className="font-medium leading-snug">{s.title}</p>
      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <Badge variant="neutral" size="sm">
          {s.system}
        </Badge>
        <span>
          Worked {plural(s.successes ?? 0, 'time')}
          {s.failures ? ` · didn’t work ${plural(s.failures, 'time')}` : ''}
        </span>
        {s.lastUsedAt && <span>Last used {timeAgo(s.lastUsedAt)}</span>}
      </p>
      {s.autoDisabled && (
        <Callout tone="warning" className="mt-3 py-2.5">
          Switched off after {s.failStreak ?? 3} tries in a row didn’t work — your PMS screens may have changed. It turns back on by itself the next time the operator finishes this kind of task. You can also switch it on now.
        </Callout>
      )}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="mt-2 inline-flex min-h-9 items-center gap-1 rounded-md text-sm font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {open ? 'Hide' : 'Show'} {plural(steps.length, 'step')}
        <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      <div id={id} hidden={!open}>
        <Steps steps={steps} />
      </div>
      <RowTools s={s} a={a} editLabel="Edit steps" />
    </RowShell>
  );
}

/** A shortcut agents noticed people run a lot. */
function SuggestionRow({ s, a }: { s: SkillView; a: Actions }) {
  return (
    <li className="px-4 py-4 sm:px-5">
      <p className="font-medium leading-snug">{s.title}</p>
      <Steps steps={s.steps ?? []} />
      <p className="mt-2 text-xs text-muted-foreground">{s.description.replace(/\s*Runs:.*$/, '')}</p>
      {a.canManage && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" size="sm" loading={a.busyId === s.id} onClick={() => a.toggle(s, true)}>
            Approve<span className="sr-only"> “{s.title}”</span>
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => a.edit(s)}>
            Rename and approve
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={a.busyId === s.id} onClick={() => a.toggle(s, false)}>
            Dismiss<span className="sr-only"> “{s.title}”</span>
          </Button>
        </div>
      )}
    </li>
  );
}

function Section({
  id,
  icon,
  title,
  description,
  action,
  children,
  tone = 'neutral',
}: {
  id: string;
  icon: LucideIcon;
  title: string;
  description: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  tone?: 'neutral' | 'agent' | 'brand';
}) {
  return (
    <Card id={id} className="scroll-mt-20 overflow-hidden p-0" aria-labelledby={`${id}-title`}>
      <div className="flex items-start gap-4 p-5 sm:p-6">
        <IconTile icon={icon} tone={tone} size="lg" className="hidden sm:flex" />
        <SectionHeader id={`${id}-title`} title={title} description={description} action={action} className="min-w-0 flex-1" />
      </div>
      <div className="border-t">{children}</div>
    </Card>
  );
}

function SubHeading({ children, count }: { children: React.ReactNode; count: number }) {
  return (
    <h3 className="flex items-center gap-2 border-b bg-surface-sunken/50 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground sm:px-5">
      {children}
      <span className="rounded-full bg-muted px-1.5 text-2xs tabular">{count}</span>
    </h3>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-5 py-6 text-center text-sm leading-relaxed text-muted-foreground">{children}</p>;
}

export default function SkillsPage() {
  const { property, propertyId } = useConsole();
  const url = usePropertyUrl('/api/admin/skills');
  const { data, error, mutate } = useSWR<SkillsResponse>(url, fetcher, { revalidateOnFocus: false });
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [answerDialog, setAnswerDialog] = React.useState<{ open: boolean; skill: SkillView | null }>({ open: false, skill: null });
  const [stepsDialog, setStepsDialog] = React.useState<{ open: boolean; skill: SkillView | null; kind: 'MACRO' | 'RECIPE'; approve?: boolean }>({ open: false, skill: null, kind: 'MACRO' });
  const [deleting, setDeleting] = React.useState<SkillView | null>(null);
  const [deleteBusy, setDeleteBusy] = React.useState(false);

  const skills = data?.skills ?? [];
  const config = skills.filter((s) => s.source === 'CONFIG');
  const suggested = skills.filter((s) => s.status === 'SUGGESTED');
  const learned = skills.filter((s) => s.source === 'LEARNED' && s.status !== 'SUGGESTED');
  const shortcuts = learned.filter((s) => s.kind === 'MACRO');
  const recipes = learned.filter((s) => s.kind === 'RECIPE');
  const manual = skills.filter((s) => s.source === 'MANUAL' && s.status !== 'SUGGESTED');
  const learnedAnswers = learned.filter((s) => s.kind === 'ANSWER');
  const showRecipes = recipes.length > 0 || property?.setupPath === 'BRIDGE';

  async function patch(s: SkillView, body: Record<string, unknown>, success: string): Promise<boolean> {
    setBusyId(s.id);
    try {
      await api(`/api/admin/skills/${s.id}`, { method: 'PATCH', json: body });
      toast.success(success);
      await mutate();
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    } finally {
      setBusyId(null);
    }
  }

  const actions: Actions = {
    canManage: !!data?.canManage,
    guestLocked: !!data?.guestAnswersLocked,
    busyId,
    toggle: (s, on) => {
      const msg =
        s.status === 'SUGGESTED' ? (on ? `“${s.title}” is now a shortcut` : 'Suggestion dismissed') : on ? `Agents will use “${s.title}” again` : `Agents won’t use “${s.title}”`;
      void patch(s, { status: on ? 'ACTIVE' : 'DISABLED' }, msg);
    },
    edit: (s) => {
      if (s.kind === 'ANSWER') setAnswerDialog({ open: true, skill: s });
      else setStepsDialog({ open: true, skill: s, kind: s.kind, approve: s.status === 'SUGGESTED' });
    },
    remove: (s) => setDeleting(s),
  };

  async function saveAnswer(d: AnswerDraft): Promise<boolean> {
    const editing = answerDialog.skill;
    if (editing) return patch(editing, { title: d.question, answer: d.answer, audience: d.audience }, 'Answer saved');
    try {
      await api('/api/admin/skills', { method: 'POST', json: { propertyId, kind: 'ANSWER', question: d.question, answer: d.answer, audience: d.audience } });
      toast.success('Answer added — agents can use it right away');
      await mutate();
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    }
  }

  async function saveSteps(d: StepsDraft): Promise<boolean> {
    const editing = stepsDialog.skill;
    if (editing) {
      return patch(
        editing,
        { title: d.name, steps: d.steps, ...(stepsDialog.approve ? { status: 'ACTIVE' } : {}) },
        stepsDialog.approve ? `“${d.name}” is now a shortcut` : editing.kind === 'RECIPE' ? 'Recipe saved' : 'Shortcut saved',
      );
    }
    try {
      await api('/api/admin/skills', { method: 'POST', json: { propertyId, kind: 'MACRO', name: d.name, steps: d.steps } });
      toast.success(`Shortcut added — say “${d.name.toLowerCase()}” to the agent`);
      await mutate();
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await api(`/api/admin/skills/${deleting.id}`, { method: 'DELETE' });
      toast.success(`Deleted “${deleting.title}”`);
      setDeleting(null);
      await mutate();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDeleteBusy(false);
    }
  }

  const counts = data
    ? [
        plural(skills.filter((s) => s.kind === 'ANSWER' && s.status === 'ACTIVE').length, 'answer'),
        plural(skills.filter((s) => s.kind === 'MACRO' && s.status === 'ACTIVE').length, 'shortcut'),
        ...(showRecipes ? [plural(recipes.filter((s) => s.status === 'ACTIVE').length, 'PMS recipe')] : []),
      ].join(' · ')
    : null;

  return (
    <PageShell
      size="narrow"
      title="Skills"
      description="What your agents know and can do. They answer from your settings, learn shortcuts from your team, and use anything you add here."
      actions={
        <Button asChild variant="outline" className="h-11 sm:h-10">
          <Link href="/admin/agent">
            <Sparkles aria-hidden /> Try it in the agent
          </Link>
        </Button>
      }
    >
      {error ? (
        <Callout tone="danger" role="alert">
          {(error as Error).message}
        </Callout>
      ) : !data ? (
        <div className="space-y-6" aria-busy>
          <Skeleton className="h-[280px] rounded-2xl" />
          <Skeleton className="h-[220px] rounded-2xl" />
          <span className="sr-only" role="status">
            Loading skills…
          </span>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground" aria-live="polite">
              <span className="font-medium text-foreground">{property?.name}</span> · {counts} switched on
            </p>
            {suggested.length > 0 && (
              <a
                href="#suggested"
                className="inline-flex min-h-9 items-center gap-1.5 self-start rounded-full bg-agent-soft px-3 text-sm font-medium text-agent-soft-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:self-auto"
              >
                <Lightbulb className="size-4" aria-hidden />
                {plural(suggested.length, 'suggestion')} to review
              </a>
            )}
          </div>

          {!data.canManage && (
            <Callout tone="neutral" icon={BookOpenText}>
              You can see what your agents know. A manager or owner can switch things on or off and add new answers.
            </Callout>
          )}

          {suggested.length > 0 && (
            <Section
              id="suggested"
              icon={Lightbulb}
              tone="agent"
              title="Suggested by your agents"
              description="Things your team asks for again and again. Approve one and anyone can run it by name."
            >
              <ul className="divide-y">
                {suggested.map((s) => (
                  <SuggestionRow key={s.id} s={s} a={actions} />
                ))}
              </ul>
            </Section>
          )}

          <Section
            id="settings"
            icon={Settings2}
            title="From your settings"
            description="Answers made from your FAQs, amenities, policies, rooms and contact details. Agents use them with guests and staff. To change the words, edit them where they come from."
          >
            {data.guestAnswersLocked && (
              <div className="border-b p-4 sm:px-5">
                <Callout tone="info" className="py-2.5">
                  {data.guestAnswersLocked}
                </Callout>
              </div>
            )}
            {config.length ? (
              <ul className="divide-y">
                {config.map((s) => (
                  <AnswerRow key={s.id} s={s} a={actions} />
                ))}
              </ul>
            ) : (
              <Empty>
                Nothing yet. Add FAQs in{' '}
                <Link href="/admin/voice#settings" className="font-medium text-primary underline-offset-4 hover:underline">
                  Voice settings
                </Link>{' '}
                and they show up here.
              </Empty>
            )}
          </Section>

          <Section
            id="learned"
            icon={Zap}
            tone="agent"
            title="Learned by your agents"
            description={
              showRecipes
                ? 'Shortcuts your team saved in the agent, and the steps the PMS operator found that work. Both get better as they’re used.'
                : 'Shortcuts your team saved in the agent. In the agent, do something once, then say “save that as a shortcut called …”.'
            }
          >
            <SubHeading count={shortcuts.length}>Shortcuts</SubHeading>
            {shortcuts.length ? (
              <ul className="divide-y">
                {shortcuts.map((s) => (
                  <ShortcutRow key={s.id} s={s} a={actions} />
                ))}
              </ul>
            ) : (
              <Empty>
                No shortcuts yet. Ask the agent to do something — like “check out room 201” — then say “save that as a shortcut called quick checkout”. Next time, “quick checkout for
                Smith” does it again.
              </Empty>
            )}
            {showRecipes && (
              <>
                <div className={cn(shortcuts.length > 0 && 'border-t')}>
                  <SubHeading count={recipes.length}>PMS recipes</SubHeading>
                </div>
                {recipes.length ? (
                  <ul className="divide-y">
                    {recipes.map((s) => (
                      <RecipeRow key={s.id} s={s} a={actions} />
                    ))}
                  </ul>
                ) : (
                  <Empty>When the PMS operator finishes a task, it saves the screens and buttons it used here — and follows them next time.</Empty>
                )}
              </>
            )}
            {learnedAnswers.length > 0 && (
              <>
                <div className="border-t">
                  <SubHeading count={learnedAnswers.length}>Answers</SubHeading>
                </div>
                <ul className="divide-y">
                  {learnedAnswers.map((s) => (
                    <AnswerRow key={s.id} s={s} a={actions} />
                  ))}
                </ul>
              </>
            )}
          </Section>

          <Section
            id="added"
            icon={MessageSquareText}
            tone="brand"
            title="Added by you"
            description="Answers and shortcuts your team wrote. Agents can use a new answer straight away."
            action={
              data.canManage ? (
                <div className="hidden gap-2 sm:flex">
                  <Button type="button" variant="outline" size="sm" onClick={() => setStepsDialog({ open: true, skill: null, kind: 'MACRO' })}>
                    <Plus aria-hidden /> Add a shortcut
                  </Button>
                  <Button type="button" size="sm" onClick={() => setAnswerDialog({ open: true, skill: null })}>
                    <Plus aria-hidden /> Add an answer
                  </Button>
                </div>
              ) : undefined
            }
          >
            {data.canManage && (
              <div className="flex flex-col gap-2 border-b p-4 sm:hidden">
                <Button type="button" className="h-11" onClick={() => setAnswerDialog({ open: true, skill: null })}>
                  <Plus aria-hidden /> Add an answer
                </Button>
                <Button type="button" variant="outline" className="h-11" onClick={() => setStepsDialog({ open: true, skill: null, kind: 'MACRO' })}>
                  <Plus aria-hidden /> Add a shortcut
                </Button>
              </div>
            )}
            {manual.length ? (
              <ul className="divide-y">
                {manual.map((s) => (s.kind === 'ANSWER' ? <AnswerRow key={s.id} s={s} a={actions} /> : s.kind === 'MACRO' ? <ShortcutRow key={s.id} s={s} a={actions} /> : <RecipeRow key={s.id} s={s} a={actions} />))}
              </ul>
            ) : (
              <Empty>Nothing added yet. Add an answer for questions your settings don’t cover — like late checkout, luggage storage or the nearest pharmacy.</Empty>
            )}
          </Section>

          {data.pmsTools > 0 && (
            <p className="flex items-start gap-2 text-sm text-muted-foreground">
              <Cable className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                Your PMS also gives agents {plural(data.pmsTools, 'tool')}.{' '}
                <Link href="/admin/connect" className="font-medium text-primary underline-offset-4 hover:underline">
                  Manage them on Your PMS
                </Link>
                .
              </span>
            </p>
          )}
        </>
      )}

      <AnswerDialog
        open={answerDialog.open}
        onOpenChange={(o) => setAnswerDialog((d) => ({ ...d, open: o }))}
        initial={answerDialog.skill}
        guestLocked={!!data?.guestAnswersLocked}
        onSave={saveAnswer}
      />
      <StepsDialog open={stepsDialog.open} onOpenChange={(o) => setStepsDialog((d) => ({ ...d, open: o }))} initial={stepsDialog.skill} kind={stepsDialog.kind} onSave={saveSteps} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete “${deleting?.title ?? ''}”?`}
        description={
          deleting?.kind === 'RECIPE'
            ? 'The PMS operator forgets these steps. It learns them again the next time a task like this works.'
            : deleting?.kind === 'MACRO'
              ? 'Nobody can run it by name any more. To keep it but stop it for now, switch it off instead.'
              : 'Agents stop giving this answer. To keep it but stop it for now, switch it off instead.'
        }
        confirmLabel="Delete"
        destructive
        loading={deleteBusy}
        onConfirm={() => void confirmDelete()}
      />
    </PageShell>
  );
}
