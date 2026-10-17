'use client';

import * as React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import useSWR, { useSWRConfig } from 'swr';
import type { InterfaceMode, StaffContext, StaffProperty } from '@/lib/dto';
import { fetcher } from '@/lib/fetcher';
import { homeForProperty } from '@/lib/routes';

interface ConsoleState {
  ctx: StaffContext | undefined;
  loading: boolean;
  error: Error | undefined;
  property: StaffProperty | undefined;
  propertyId: string | undefined;
  setPropertyId: (id: string) => void;
  /** The surface you're on right now: the agent workspace is Agentic, everything else Classic. */
  mode: InterfaceMode;
  /** Where you land by default: your last explicit choice, else the property's default. */
  preferredMode: InterfaceMode;
  setMode: (mode: InterfaceMode, opts?: { navigate?: boolean }) => void;
  /** True when the person picked a mode themselves (vs following the property default). */
  hasModePreference: boolean;
  /** Forget the personal choice and follow the property default again. */
  clearModePreference: () => void;
  can: (perm: string) => boolean;
  role: string | undefined;
  commandOpen: boolean;
  setCommandOpen: (open: boolean) => void;
  /** Open the agent (side sheet in Classic) and send this command. */
  askAgent: (command: string) => void;
  /** A command waiting to be sent by the agent panel that opens next. */
  pendingCommand: string | null;
  takePendingCommand: () => string | null;
  /** Revalidate every staff API view (after the agent changes something). */
  refresh: () => void;
  homeHref: string;
}

const Ctx = React.createContext<ConsoleState | null>(null);

const read = (key: string) => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string | null) => {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* storage may be unavailable (private mode) — preference just won't persist */
  }
};

export function ConsoleProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { mutate } = useSWRConfig();
  const { data: ctx, error, isLoading } = useSWR<StaffContext>('/api/admin/context', fetcher, {
    revalidateOnFocus: false,
  });

  const userId = ctx?.user.id;
  const [propertyId, setPropertyIdState] = React.useState<string>();
  const [modeOverride, setModeOverride] = React.useState<InterfaceMode | null>(null);
  const [commandOpen, setCommandOpen] = React.useState(false);
  const [pendingCommand, setPendingCommand] = React.useState<string | null>(null);
  const pendingRef = React.useRef<string | null>(null);

  // Pick the remembered property (or the first one) once we know the user.
  React.useEffect(() => {
    if (!ctx || propertyId) return;
    const remembered = read(`stayos:property:${ctx.user.id}`);
    const valid = ctx.properties.find((p) => p.id === remembered) ?? ctx.properties[0];
    if (valid) setPropertyIdState(valid.id);
  }, [ctx, propertyId]);

  // Load the person's mode preference for this property.
  React.useEffect(() => {
    if (!userId || !propertyId) return;
    const saved = read(`stayos:mode:${userId}:${propertyId}`);
    setModeOverride(saved === 'AGENTIC' || saved === 'CLASSIC' ? saved : null);
  }, [userId, propertyId]);

  const property = ctx?.properties.find((p) => p.id === propertyId);
  const canUseAgent = !!ctx?.permissions.includes('agent.use');
  const preferredMode: InterfaceMode = canUseAgent ? (modeOverride ?? property?.interfaceMode ?? 'CLASSIC') : 'CLASSIC';
  const mode: InterfaceMode = canUseAgent && pathname.startsWith('/admin/agent') ? 'AGENTIC' : 'CLASSIC';
  const homeHref = homeForProperty(ctx?.user.role, property?.setupPath);

  const setPropertyId = React.useCallback(
    (id: string) => {
      setPropertyIdState(id);
      if (userId) write(`stayos:property:${userId}`, id);
    },
    [userId]
  );

  const setMode = React.useCallback(
    (next: InterfaceMode, opts: { navigate?: boolean } = { navigate: true }) => {
      setModeOverride(next);
      if (userId && propertyId) write(`stayos:mode:${userId}:${propertyId}`, next);
      if (opts.navigate === false) return;
      if (next === 'AGENTIC' && !pathname.startsWith('/admin/agent')) router.push('/admin/agent');
      if (next === 'CLASSIC' && pathname.startsWith('/admin/agent')) router.push(homeHref);
    },
    [userId, propertyId, pathname, router, homeHref]
  );

  const clearModePreference = React.useCallback(() => {
    setModeOverride(null);
    if (userId && propertyId) write(`stayos:mode:${userId}:${propertyId}`, null);
  }, [userId, propertyId]);

  const can = React.useCallback((perm: string) => !!ctx?.permissions.includes(perm), [ctx]);

  const askAgent = React.useCallback(
    (command: string) => {
      pendingRef.current = command;
      setPendingCommand(command);
      if (pathname.startsWith('/admin/agent')) return;
      setCommandOpen(true);
    },
    [pathname]
  );

  const takePendingCommand = React.useCallback(() => {
    const c = pendingRef.current;
    pendingRef.current = null;
    setPendingCommand(null);
    return c;
  }, []);

  const refresh = React.useCallback(() => {
    void mutate((key) => typeof key === 'string' && key.startsWith('/api/admin/') && key !== '/api/admin/context');
  }, [mutate]);

  // Global shortcut: ⌘K / Ctrl+K opens the agent from anywhere.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (pathname.startsWith('/admin/agent')) {
          document.getElementById('agent-composer')?.focus();
        } else if (canUseAgent) {
          setCommandOpen((o) => !o);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pathname, canUseAgent]);

  const value: ConsoleState = {
    ctx,
    loading: isLoading,
    error: error as Error | undefined,
    property,
    propertyId,
    setPropertyId,
    mode,
    preferredMode,
    setMode,
    hasModePreference: modeOverride !== null,
    clearModePreference,
    can,
    role: ctx?.user.role,
    commandOpen,
    setCommandOpen,
    askAgent,
    pendingCommand,
    takePendingCommand,
    refresh,
    homeHref,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useConsole(): ConsoleState {
  const v = React.useContext(Ctx);
  if (!v) throw new Error('useConsole must be used inside <ConsoleProvider>');
  return v;
}

/** Build a staff API URL scoped to the selected property (null until known). */
export function usePropertyUrl(path: string, params: Record<string, string | number | undefined> = {}): string | null {
  const { propertyId } = useConsole();
  if (!propertyId) return null;
  const q = new URLSearchParams({ propertyId });
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v));
  return `${path}?${q.toString()}`;
}
