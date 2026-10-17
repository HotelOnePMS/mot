'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowRight, CircleCheck, Mail, MonitorPlay, Rocket, Send } from 'lucide-react';
import Navigation from '@/components/Navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { SiteFooter } from '@/components/guest/SiteFooter';
import { PRODUCT_NAME, PRODUCT_SUPPORT_EMAIL } from '@/config/product';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type FormState = { name: string; hotel: string; email: string; message: string };
type Errors = Partial<Record<keyof FormState, string>>;

const WAYS = [
  { icon: Mail, title: 'Email us', text: PRODUCT_SUPPORT_EMAIL, href: `mailto:${PRODUCT_SUPPORT_EMAIL}` },
  { icon: Rocket, title: 'Prefer to just try it?', text: 'Set up your hotel in a few minutes', href: '/onboarding' },
  { icon: MonitorPlay, title: 'See it working', text: 'Open the live demo with one-click logins', href: '/login' },
];

function validate(form: FormState): Errors {
  const e: Errors = {};
  if (!form.name.trim()) e.name = 'Tell us your name.';
  if (!form.email.trim()) e.email = 'Enter the email we should reply to.';
  else if (!EMAIL_RE.test(form.email.trim())) e.email = 'Enter an email address like name@example.com.';
  if (!form.message.trim()) e.message = 'Write a short message so we know how to help.';
  return e;
}

export default function ContactPage() {
  const [form, setForm] = React.useState<FormState>({ name: '', hotel: '', email: '', message: '' });
  const [errors, setErrors] = React.useState<Errors>({});
  const [opened, setOpened] = React.useState(false);
  const refs = React.useRef<Partial<Record<keyof FormState, HTMLInputElement | HTMLTextAreaElement | null>>>({});

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const value = e.target.value;
    setForm((f) => ({ ...f, [k]: value }));
    if (errors[k]) setErrors((x) => ({ ...x, [k]: undefined }));
  };

  const a11y = (k: keyof FormState) => ({
    ref: (el: HTMLInputElement | HTMLTextAreaElement | null) => {
      refs.current[k] = el;
    },
    value: form[k],
    onChange: set(k),
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const found = validate(form);
    setErrors(found);
    const first = (['name', 'email', 'message'] as const).find((k) => found[k]);
    if (first) {
      refs.current[first]?.focus();
      return;
    }
    const subject = `${PRODUCT_NAME} — ${form.hotel.trim() || form.name.trim()}`;
    const body = `${form.message.trim()}\n\n— ${form.name.trim()}${form.hotel.trim() ? `, ${form.hotel.trim()}` : ''}\n${form.email.trim()}`;
    window.location.href = `mailto:${PRODUCT_SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    setOpened(true);
  }

  return (
    <div className="relative flex min-h-dvh flex-col overflow-x-clip bg-background">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[480px] bg-[radial-gradient(ellipse_at_20%_0%,hsl(var(--primary)/0.10),transparent_60%)]"
        aria-hidden
      />
      <Navigation variant="marketing" />
      <main id="main" className="relative flex-1">
        <div className="relative mx-auto grid max-w-6xl gap-12 px-4 py-12 sm:px-6 sm:py-16 lg:grid-cols-[1fr_1.1fr] lg:gap-16 lg:py-20">
          <div>
            <p className="text-2xs font-semibold uppercase tracking-[0.18em] text-primary">Contact</p>
            <h1 className="mt-3 font-display text-4xl font-medium tracking-tight sm:text-5xl">Talk to us</h1>
            <p className="mt-4 max-w-md text-lg leading-relaxed text-muted-foreground">
              Questions about switching, keeping your current system, or the AI phone agent? A person reads every message.
            </p>
            <ul className="mt-10 space-y-3">
              {WAYS.map((c) => (
                <li key={c.title}>
                  <Link
                    href={c.href}
                    className="group flex items-center gap-4 rounded-2xl border bg-card p-4 shadow-xs transition-[border-color,box-shadow] hover:border-primary/30 hover:shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary-soft-foreground">
                      <c.icon className="h-5 w-5" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{c.title}</span>
                      <span className="block break-words text-sm text-muted-foreground">{c.text}</span>
                    </span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary motion-reduce:transition-none" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <form onSubmit={onSubmit} noValidate aria-labelledby="contact-form-title" className="rounded-3xl border bg-card p-5 shadow-soft sm:p-8">
            <h2 id="contact-form-title" className="font-display text-2xl font-medium tracking-tight">
              Send us a message
            </h2>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <Field htmlFor="c-name" label="Your name" error={errors.name}>
                <Input id="c-name" required autoComplete="name" className="h-11 text-base md:text-sm" {...a11y('name')} />
              </Field>
              <Field htmlFor="c-hotel" label="Hotel (optional)">
                <Input id="c-hotel" autoComplete="organization" className="h-11 text-base md:text-sm" {...a11y('hotel')} />
              </Field>
              <Field htmlFor="c-email" label="Email" error={errors.email} className="sm:col-span-2">
                <Input id="c-email" type="email" inputMode="email" autoCapitalize="none" spellCheck={false} required autoComplete="email" className="h-11 text-base md:text-sm" {...a11y('email')} />
              </Field>
              <Field htmlFor="c-message" label="How can we help?" error={errors.message} className="sm:col-span-2">
                <Textarea
                  id="c-message"
                  rows={6}
                  required
                  placeholder="We run a 30-room motel on Cloudbeds and want to try the phone agent…"
                  className="text-base md:text-sm"
                  {...a11y('message')}
                />
              </Field>
            </div>
            <Button type="submit" size="lg" className="mt-6 w-full">
              <Send className="h-4 w-4" aria-hidden /> Write the email
            </Button>
            <div role="status" aria-live="polite" className="mt-3">
              {opened ? (
                <p className="flex items-start gap-2 rounded-xl bg-success-soft px-3.5 py-3 text-sm text-success-soft-foreground">
                  <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <span>
                    Your email app should now be open with the message ready to send. Nothing opened? Email us at{' '}
                    <a href={`mailto:${PRODUCT_SUPPORT_EMAIL}`} className="font-medium underline underline-offset-2">
                      {PRODUCT_SUPPORT_EMAIL}
                    </a>
                    .
                  </span>
                </p>
              ) : (
                <p className="text-center text-xs text-muted-foreground">Opens your email app with this message ready to send to {PRODUCT_SUPPORT_EMAIL}.</p>
              )}
            </div>
          </form>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
