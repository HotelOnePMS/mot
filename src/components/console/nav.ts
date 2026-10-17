import {
  Bot,
  Zap,
  BadgeDollarSign,
  BedDouble,
  Building2,
  CalendarCheck2,
  ChartLine,
  ConciergeBell,
  History,
  LayoutDashboard,
  Settings2,
  Sparkles,
  BrushCleaning,
  Users,
  AudioLines,
  Cable,
  type LucideIcon,
} from 'lucide-react';
import type { SetupPath } from '@/lib/dto';
import { canAccessConsolePath } from '@/lib/routes';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** The AI agent's own screen: shown with the agent's violet treatment. */
  agent?: boolean;
  /** Setup paths this screen belongs to (default: the hotel runs fully on HotelOne). */
  paths?: SetupPath[];
}

const ALL: SetupPath[] = ['FULL', 'BRIDGE', 'VOICE'];

export interface NavGroup {
  label: string;
  items: NavItem[];
}

const GROUPS: NavGroup[] = [
  {
    label: 'Operate',
    items: [
      { label: 'Agent', href: '/admin/agent', icon: Sparkles, agent: true, paths: ['FULL', 'BRIDGE'] },
      { label: 'Your PMS', href: '/admin/connect', icon: Cable, paths: ['BRIDGE'] },
      { label: 'Dashboard', href: '/admin/dashboard', icon: LayoutDashboard },
      { label: 'Front desk', href: '/admin/front-desk', icon: ConciergeBell },
      { label: 'Housekeeping', href: '/admin/housekeeping', icon: BrushCleaning },
      { label: 'Reservations', href: '/admin/bookings', icon: CalendarCheck2 },
      { label: 'Voice', href: '/admin/voice', icon: AudioLines, paths: ALL },
    ],
  },
  {
    label: 'Revenue',
    items: [
      { label: 'Rates', href: '/admin/rate-calendar', icon: BadgeDollarSign, paths: ['FULL', 'VOICE'] },
      { label: 'Analytics', href: '/admin/analytics', icon: ChartLine },
    ],
  },
  {
    label: 'Setup',
    items: [
      { label: 'Rooms', href: '/admin/room-types', icon: BedDouble, paths: ALL },
      { label: 'Skills', href: '/admin/skills', icon: Zap, paths: ALL },
      { label: 'Properties', href: '/admin/properties', icon: Building2, paths: ALL },
      { label: 'AI assistants', href: '/admin/assistants', icon: Bot, paths: ALL },
      { label: 'Team', href: '/admin/users', icon: Users, paths: ALL },
      { label: 'Activity', href: '/admin/activity', icon: History, paths: ALL },
      { label: 'Settings', href: '/admin/settings', icon: Settings2, paths: ALL },
    ],
  },
];

/** Navigation filtered to what this role can open (same rules as middleware). */
export function navFor(role: string | undefined, opts: { agentEnabled: boolean; setupPath?: SetupPath }): NavGroup[] {
  const path = opts.setupPath ?? 'FULL';
  return GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => canAccessConsolePath(role, i.href) && (!i.agent || opts.agentEnabled) && (i.paths ?? ['FULL']).includes(path)),
  })).filter((g) => g.items.length > 0);
}

/** The console section a path belongs to ("Front desk"), for the header and breadcrumb. */
export function titleFor(pathname: string): string {
  for (const g of GROUPS) for (const i of g.items) if (pathname === i.href || pathname.startsWith(i.href + '/')) return i.label;
  return 'Console';
}
