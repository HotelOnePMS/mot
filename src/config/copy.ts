/**
 * One label per concept, shared by every header, footer, menu and CTA.
 *
 * Inline strings drifted ("Start free", "Get started", "Set up your hotel"
 * for the same link), so platform chrome takes its words from here.
 */
import { PRODUCT_NAME } from '@/config/product';

export const LABELS = {
  /** Hotel sign-up: every link to /onboarding. */
  hotelSignup: 'Set up your hotel',
  /** Traveller sign-up: every link to /register. */
  travellerSignup: 'Create a traveller account',
  signIn: 'Sign in',
  signOut: 'Sign out',
  /** The hotel directory at /properties. */
  findStay: 'Find a stay',
  /** /demo: the demo hotel's booking site and the one-click console logins. */
  demo: 'Live demo',
  /** The traveller's bookings at /dashboard. */
  myTrips: 'My trips',
  profile: 'Profile',
  /** The staff area under /admin. */
  console: 'Hotel console',
  contact: 'Contact us',
  /** A hotel's public page, opened from the console. */
  bookingSite: 'View booking site',
} as const;

/** Names of the AI surfaces. */
export const TERMS = {
  agent: 'AI agent',
  voice: 'Voice front desk',
  assistants: 'AI assistants',
} as const;

/** The three ways to start, as named on the landing page, About and onboarding. */
export const SETUP_PATH_COPY = {
  FULL: { title: `Run on ${PRODUCT_NAME}`, cta: LABELS.hotelSignup, badge: 'Most complete' },
  BRIDGE: { title: 'Keep your PMS', cta: 'Connect your system', badge: 'No migration' },
  VOICE: { title: 'Just voice', cta: 'Start with voice', badge: 'Fastest' },
} as const;
