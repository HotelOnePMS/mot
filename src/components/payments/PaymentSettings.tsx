'use client';

import * as React from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { Building2, CreditCard, ExternalLink, ShieldCheck } from 'lucide-react';
import { api, fetcher } from '@/lib/fetcher';
import { PAYMENT_POLICY_LABEL, type PaymentPolicy } from '@/lib/payments';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Callout } from '@/components/ui/primitives';

interface Settings {
  stripeAvailable: boolean;
  connected: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  policy: PaymentPolicy;
  depositNights: number;
  maxDepositNights: number;
  platformFeePercent: number;
  highAmountThreshold: number;
}

const OPTIONS: { value: PaymentPolicy; text: string; icon: typeof Building2 }[] = [
  { value: 'PAY_AT_PROPERTY', text: 'Guests book without paying. You collect at the property (today’s default).', icon: Building2 },
  { value: 'DEPOSIT', text: 'Guests pay the first night(s) by card to book. The rest is paid at the property.', icon: CreditCard },
  { value: 'FULL_PREPAYMENT', text: 'Guests pay the whole stay by card to book.', icon: CreditCard },
];

/** Settings → Online payments: connect the hotel's Stripe account and choose how guests pay. */
export function PaymentSettings({ propertyId }: { propertyId: string }) {
  const key = `/api/admin/properties/${propertyId}/payments`;
  // After Stripe's onboarding page sends the owner back, re-read the account's status from Stripe once.
  const [refresh] = React.useState(() => typeof window !== 'undefined' && /[?&]stripe=(return|refresh)/.test(window.location.search));
  const { data, mutate, error } = useSWR<Settings>(refresh ? `${key}?refresh=1` : key, fetcher);
  const [policy, setPolicy] = React.useState<PaymentPolicy | null>(null);
  const [nights, setNights] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<'connect' | 'save' | 'dashboard' | null>(null);

  if (error) return <Callout tone="danger">{(error as Error).message}</Callout>;
  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const chosen = policy ?? data.policy;
  const nightsValue = nights ?? String(data.depositNights);
  const nightsNumber = Math.floor(Number(nightsValue));
  const nightsOk = chosen !== 'DEPOSIT' || (nightsNumber >= 1 && nightsNumber <= data.maxDepositNights);
  const changed = chosen !== data.policy || (chosen === 'DEPOSIT' && nightsNumber !== data.depositNights);
  const canPick = (p: PaymentPolicy) => p === 'PAY_AT_PROPERTY' || data.chargesEnabled;

  async function go(kind: 'connect' | 'dashboard') {
    setBusy(kind);
    try {
      const r = await api<{ url: string }>(`${key}/${kind}`, { method: 'POST' });
      window.location.href = r.url;
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(null);
    }
  }

  async function save() {
    setBusy('save');
    try {
      await api(key, { method: 'PUT', json: { policy: chosen, depositNights: chosen === 'DEPOSIT' ? nightsNumber : data!.depositNights } });
      await mutate();
      setPolicy(null);
      setNights(null);
      toast.success('Payment policy saved');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const status = !data.connected ? 'Not connected' : data.chargesEnabled ? 'Connected' : data.detailsSubmitted ? 'Under review by Stripe' : 'Setup not finished';

  return (
    <div className="space-y-5">
      {!data.stripeAvailable && <Callout tone="info">Online payments aren’t switched on for this HotelOne deployment yet, so guests pay at the property.</Callout>}

      <div className="flex flex-wrap items-center gap-3 rounded-xl border p-4">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm font-medium">
            Stripe account
            <Badge variant={data.chargesEnabled ? 'success' : data.connected ? 'warning' : 'neutral'} size="sm">
              {status}
            </Badge>
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {data.chargesEnabled
              ? `Guests pay your own Stripe account directly${data.payoutsEnabled ? ' and Stripe pays you out to your bank' : ' (payouts are not enabled yet)'}.`
              : 'Connect your Stripe account so guest payments go straight to you. HotelOne never holds your money or sees card numbers.'}
          </p>
          {data.platformFeePercent > 0 && <p className="mt-0.5 text-xs text-muted-foreground">HotelOne’s fee: {data.platformFeePercent}% of each online payment, on top of Stripe’s own fees.</p>}
        </div>
        {data.stripeAvailable && (
          <div className="flex flex-wrap gap-2">
            {!data.chargesEnabled && (
              <Button loading={busy === 'connect'} onClick={() => go('connect')}>
                {data.connected ? 'Continue Stripe setup' : 'Connect Stripe'} <ExternalLink aria-hidden />
              </Button>
            )}
            {data.connected && (
              <Button variant="outline" loading={busy === 'dashboard'} onClick={() => go('dashboard')}>
                Stripe dashboard <ExternalLink aria-hidden />
              </Button>
            )}
          </div>
        )}
      </div>

      <fieldset>
        <legend className="text-sm font-medium">How guests pay</legend>
        <div className="mt-2 grid gap-3">
          {OPTIONS.map((o) => {
            const disabled = !canPick(o.value);
            return (
              <label
                key={o.value}
                className={cn(
                  'flex items-start gap-3 rounded-xl border border-input p-4 transition-colors has-[:checked]:border-primary/60 has-[:checked]:bg-primary/5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
                  disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-accent/60'
                )}
              >
                <input type="radio" name="payment-policy" className="mt-0.5 size-5 shrink-0 accent-primary" checked={chosen === o.value} disabled={disabled} onChange={() => setPolicy(o.value)} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{PAYMENT_POLICY_LABEL[o.value]}</span>
                  <span className="mt-0.5 block text-sm text-muted-foreground">{o.text}</span>
                  {o.value === 'DEPOSIT' && chosen === 'DEPOSIT' && (
                    <span className="mt-3 flex items-center gap-2 text-sm">
                      <label htmlFor="deposit-nights">Nights charged at booking</label>
                      <Input id="deposit-nights" type="number" min={1} max={data.maxDepositNights} className="h-9 w-20" value={nightsValue} onChange={(e) => setNights(e.target.value)} />
                    </span>
                  )}
                </span>
                <o.icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
              </label>
            );
          })}
        </div>
        {!data.chargesEnabled && <p className="mt-2 text-sm text-muted-foreground">Deposits and prepayment unlock once Stripe has approved your account to take payments.</p>}
      </fieldset>

      <div className="flex items-start gap-3 rounded-xl border p-4">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
        <p className="text-sm text-muted-foreground">
          Card payments ask the guest’s bank to verify them (3D Secure), which usually moves the cost of a fraud dispute to the bank. Disputes can still happen, for example over a refund or a stay, so HotelOne keeps the evidence you’d need: the policy the guest accepted, the 3D Secure result and the check-in record. Bookings worth {data.highAmountThreshold.toLocaleString()} or more are flagged for an extra check at the front desk.
        </p>
      </div>

      {changed && (
        <div className="flex gap-2">
          <Button loading={busy === 'save'} disabled={!nightsOk} onClick={save}>
            Save payment policy
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setPolicy(null);
              setNights(null);
            }}
          >
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
