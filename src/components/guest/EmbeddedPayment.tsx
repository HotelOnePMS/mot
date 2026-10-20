'use client';

import * as React from 'react';
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from '@stripe/react-stripe-js';
import { loadStripe, type Stripe } from '@stripe/stripe-js';

/** What the booking API returns for Stripe's embedded payment form. */
export interface EmbeddedCheckoutInfo {
  clientSecret: string;
  publishableKey: string;
  /** The hotel's connected account: the session lives there (a direct charge). */
  stripeAccount: string;
}

// One Stripe.js instance per hotel account (loadStripe fetches the script once).
const loaded = new Map<string, Promise<Stripe | null>>();
function stripeFor(publishableKey: string, stripeAccount: string): Promise<Stripe | null> {
  const key = `${publishableKey}|${stripeAccount}`;
  let p = loaded.get(key);
  if (!p) {
    p = loadStripe(publishableKey, { stripeAccount });
    // A failed script load (offline, blocked) can be tried again.
    p.catch(() => loaded.delete(key));
    loaded.set(key, p);
  }
  return p;
}

/**
 * Stripe's payment form, in the page instead of on Stripe's own site. The
 * guest never leaves the booking site, so the layout (and a voice call
 * running in it) stays mounted while they pay. Card details go straight to
 * Stripe inside its iframe; HotelOne never sees them.
 */
export function EmbeddedPayment({ checkout, onComplete, onUnavailable }: { checkout: EmbeddedCheckoutInfo; onComplete: () => void; onUnavailable: () => void }) {
  const stripe = React.useMemo(() => stripeFor(checkout.publishableKey, checkout.stripeAccount), [checkout.publishableKey, checkout.stripeAccount]);
  const done = React.useRef(onComplete);
  done.current = onComplete;
  const unavailable = React.useRef(onUnavailable);
  unavailable.current = onUnavailable;
  React.useEffect(() => {
    let live = true;
    stripe.then(
      (s) => {
        if (live && !s) unavailable.current();
      },
      () => {
        if (live) unavailable.current();
      }
    );
    return () => {
      live = false;
    };
  }, [stripe]);
  const options = React.useMemo(() => ({ clientSecret: checkout.clientSecret, onComplete: () => done.current() }), [checkout.clientSecret]);
  return (
    <EmbeddedCheckoutProvider stripe={stripe} options={options}>
      <EmbeddedCheckout className="min-h-[24rem]" />
    </EmbeddedCheckoutProvider>
  );
}
