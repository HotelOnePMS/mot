'use client';

import * as React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { PartyPopper, X } from 'lucide-react';
import { IconButton } from '@/components/ui/button';

/** Shown once after onboarding (?welcome=1); dismissing removes the flag from the URL. */
export function WelcomeBanner({ title, children }: { title: string; children: React.ReactNode }) {
  const [show, setShow] = React.useState(false);
  const reduce = useReducedMotion();
  React.useEffect(() => {
    setShow(new URLSearchParams(window.location.search).get('welcome') === '1');
  }, []);
  const close = () => {
    setShow(false);
    const url = new URL(window.location.href);
    url.searchParams.delete('welcome');
    window.history.replaceState(null, '', url.toString());
  };
  return (
    <AnimatePresence>
      {show && (
        <motion.section
          aria-labelledby="welcome-banner-title"
          initial={reduce ? false : { opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8 }}
          className="relative overflow-hidden rounded-2xl border bg-card p-5 pr-14 shadow-soft"
        >
          <div className="absolute inset-x-0 top-0 h-1 bg-primary" aria-hidden />
          <h2 id="welcome-banner-title" className="flex items-center gap-2 text-base font-semibold text-primary-soft-foreground">
            <PartyPopper className="size-4 shrink-0" aria-hidden /> {title}
          </h2>
          <div className="mt-1 text-sm leading-relaxed text-muted-foreground">{children}</div>
          <IconButton label="Dismiss" size="icon-sm" onClick={close} className="absolute right-2.5 top-2.5 text-muted-foreground">
            <X />
          </IconButton>
        </motion.section>
      )}
    </AnimatePresence>
  );
}
