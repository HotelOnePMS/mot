'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { SessionProvider } from 'next-auth/react';
import { ThemeProvider, useTheme } from 'next-themes';
import { MotionConfig } from 'framer-motion';
import { Toaster, type ToasterProps } from 'sonner';
import { isConsolePath } from '@/lib/routes';

/**
 * Sonner styled with our tokens, so toasts match the theme (and the dark
 * console) instead of Sonner's own light palette. Neutral surface, with the
 * icon carrying the tone.
 */
const TOAST_VARS = {
  '--normal-bg': 'hsl(var(--popover))',
  '--normal-border': 'hsl(var(--border))',
  '--normal-text': 'hsl(var(--popover-foreground))',
  '--normal-bg-hover': 'hsl(var(--accent))',
  '--normal-border-hover': 'hsl(var(--border-strong))',
  '--success-bg': 'hsl(var(--success-soft))',
  '--success-border': 'hsl(var(--success) / 0.25)',
  '--success-text': 'hsl(var(--success-soft-foreground))',
  '--info-bg': 'hsl(var(--info-soft))',
  '--info-border': 'hsl(var(--info) / 0.25)',
  '--info-text': 'hsl(var(--info-soft-foreground))',
  '--warning-bg': 'hsl(var(--warning-soft))',
  '--warning-border': 'hsl(var(--warning) / 0.3)',
  '--warning-text': 'hsl(var(--warning-soft-foreground))',
  '--error-bg': 'hsl(var(--destructive-soft))',
  '--error-border': 'hsl(var(--destructive) / 0.25)',
  '--error-text': 'hsl(var(--destructive-soft-foreground))',
  '--border-radius': 'calc(var(--radius) + 4px)',
} as React.CSSProperties;

const TOAST_CLASSES: NonNullable<ToasterProps['toastOptions']>['classNames'] = {
  toast: 'font-sans !shadow-lifted',
  title: 'text-sm font-medium',
  description: '!text-muted-foreground text-[13px] leading-snug',
  actionButton: '!bg-primary !text-primary-foreground !rounded-md !font-medium',
  cancelButton: '!bg-muted !text-foreground !rounded-md',
  closeButton: '!size-6 !bg-popover !text-muted-foreground !border-border hover:!text-foreground',
  success: '[&_[data-icon]]:text-success',
  error: '[&_[data-icon]]:text-destructive',
  warning: '[&_[data-icon]]:text-warning-soft-foreground',
  info: '[&_[data-icon]]:text-info',
};

function useIsNarrow() {
  const [narrow, setNarrow] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return narrow;
}

function ThemedToaster() {
  const { resolvedTheme, forcedTheme } = useTheme();
  const narrow = useIsNarrow();
  const theme = (forcedTheme ?? resolvedTheme) === 'dark' ? 'dark' : 'light';
  return (
    <Toaster
      theme={theme}
      // Top on phones, so toasts never cover sticky save bars or the booking CTA.
      position={narrow ? 'top-center' : 'bottom-right'}
      closeButton
      richColors={false}
      visibleToasts={4}
      containerAriaLabel="Notifications"
      style={TOAST_VARS}
      toastOptions={{ classNames: TOAST_CLASSES }}
    />
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '/';
  // Guest-facing pages are always light (they carry the hotel's brand);
  // only the staff console follows the user's theme choice.
  const forcedTheme = isConsolePath(pathname) ? undefined : 'light';

  return (
    <SessionProvider refetchOnWindowFocus>
      <ThemeProvider
        attribute="class"
        defaultTheme="light"
        enableSystem
        forcedTheme={forcedTheme}
        storageKey="stayos-theme"
        disableTransitionOnChange
      >
        {/* Decorative motion follows the OS "reduce motion" setting. */}
        <MotionConfig reducedMotion="user">
          {children}
          <ThemedToaster />
        </MotionConfig>
      </ThemeProvider>
    </SessionProvider>
  );
}
