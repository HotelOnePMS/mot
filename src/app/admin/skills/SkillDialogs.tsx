'use client';

import * as React from 'react';
import type { SkillView } from '@/lib/dto';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { SegmentedControl } from '@/components/ui/segmented';
import { Textarea } from '@/components/ui/textarea';

export type Audience = 'ALL' | 'STAFF';

export interface AnswerDraft {
  question: string;
  answer: string;
  audience: Audience;
}

export interface StepsDraft {
  name: string;
  steps: string[];
}

const linesOf = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

/** Add or edit a saved answer: the question, what agents say, and who hears it. */
export function AnswerDialog({
  open,
  onOpenChange,
  initial,
  guestLocked,
  onSave,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Editing this answer; null to add a new one. */
  initial: SkillView | null;
  /** Guest answers can't change here (public demo): only staff-only answers. */
  guestLocked: boolean;
  onSave: (draft: AnswerDraft) => Promise<boolean>;
}) {
  const [question, setQuestion] = React.useState('');
  const [answer, setAnswer] = React.useState('');
  const [audience, setAudience] = React.useState<Audience>('ALL');
  const [errors, setErrors] = React.useState<{ question?: string; answer?: string }>({});
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setQuestion(initial?.title ?? '');
    setAnswer(initial?.answer ?? '');
    setAudience(initial ? (initial.audience === 'STAFF' ? 'STAFF' : 'ALL') : guestLocked ? 'STAFF' : 'ALL');
    setErrors({});
  }, [open, initial, guestLocked]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const next = {
      question: question.trim() ? undefined : 'Write the question, like “Is parking free?”',
      answer: answer.trim() ? undefined : 'Write the answer agents should give.',
    };
    setErrors(next);
    if (next.question || next.answer) return;
    setSaving(true);
    const ok = await onSave({ question: question.trim(), answer: answer.trim(), audience });
    setSaving(false);
    if (ok) onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="space-y-5">
          <DialogHeader>
            <DialogTitle>{initial ? 'Edit answer' : 'Add an answer'}</DialogTitle>
            <DialogDescription>Agents give this answer when someone asks the question — in the staff agent, on the phone and in chat.</DialogDescription>
          </DialogHeader>
          <Field label="Question" error={errors.question} hint="How people usually ask it.">
            <Input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. Is there a late checkout?" maxLength={120} autoComplete="off" />
          </Field>
          <Field label="Answer" error={errors.answer}>
            <Textarea value={answer} onChange={(e) => setAnswer(e.target.value)} rows={4} maxLength={4000} placeholder="e.g. Yes — until 1 PM for $30, if the room isn’t needed. Ask the front desk." />
          </Field>
          <div className="space-y-2">
            <p id="answer-audience" className="text-sm font-medium">
              Who can hear it
            </p>
            <SegmentedControl
              layoutId="answer-audience-pill"
              aria-label="Who can hear it"
              value={audience}
              onChange={setAudience}
              options={[
                { value: 'ALL', label: 'Guests & staff', disabled: guestLocked },
                { value: 'STAFF', label: 'Staff only' },
              ]}
            />
            <p className="text-xs text-muted-foreground">
              {audience === 'STAFF' ? 'Only the staff agent uses it — guests never hear it.' : 'The voice agent, phone line and guests’ AI assistants can say it too.'}
              {guestLocked && ' Answers for guests stay as they are in the demo hotels.'}
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving} loadingText="Saving…">
              {initial ? 'Save changes' : 'Add answer'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Add or edit a shortcut (commands) or a PMS recipe (instructions): a name and steps, one per line. */
export function StepsDialog({
  open,
  onOpenChange,
  initial,
  kind,
  onSave,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial: SkillView | null;
  kind: 'MACRO' | 'RECIPE';
  onSave: (draft: StepsDraft) => Promise<boolean>;
}) {
  const [name, setName] = React.useState('');
  const [steps, setSteps] = React.useState('');
  const [errors, setErrors] = React.useState<{ name?: string; steps?: string }>({});
  const [saving, setSaving] = React.useState(false);
  const recipe = kind === 'RECIPE';

  React.useEffect(() => {
    if (!open) return;
    setName(initial?.title ?? '');
    setSteps((initial?.steps ?? []).join('\n'));
    setErrors({});
  }, [open, initial]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const lines = linesOf(steps);
    const next = {
      name: name.trim() ? undefined : recipe ? 'Give it a name.' : 'Give the shortcut a short name, like “late checkout”.',
      steps: lines.length ? (lines.length > (recipe ? 40 : 20) ? `At most ${recipe ? 40 : 20} steps.` : undefined) : recipe ? 'Keep at least one step.' : 'Add at least one step — a command you’d type to the agent.',
    };
    setErrors(next);
    if (next.name || next.steps) return;
    setSaving(true);
    const ok = await onSave({ name: name.trim(), steps: lines });
    setSaving(false);
    if (ok) onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="space-y-5">
          <DialogHeader>
            <DialogTitle>{recipe ? 'Edit PMS recipe' : initial ? 'Edit shortcut' : 'Add a shortcut'}</DialogTitle>
            <DialogDescription>
              {recipe
                ? 'The steps the PMS operator is given for this kind of task. Keep them general — no guest names, codes or numbers.'
                : 'A shortcut runs these commands in the staff agent, one after another. Changes still wait for someone to confirm them.'}
            </DialogDescription>
          </DialogHeader>
          <Field label="Name" error={errors.name} hint={recipe ? undefined : 'What staff will say to run it.'}>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={recipe ? undefined : 'e.g. late checkout'} maxLength={recipe ? 120 : 60} autoComplete="off" />
          </Field>
          <Field
            label="Steps"
            error={errors.steps}
            hint={recipe ? 'One step per line.' : 'One command per line, as you’d type it to the agent. Write {guest}, {room} or {date} for the parts that change.'}
          >
            <Textarea
              value={steps}
              onChange={(e) => setSteps(e.target.value)}
              rows={recipe ? 7 : 4}
              className="font-mono text-[13px]"
              placeholder={recipe ? undefined : 'check out {guest}\nadd a note to {guest}: late checkout until 1 PM'}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving} loadingText="Saving…">
              {initial ? 'Save changes' : 'Add shortcut'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
