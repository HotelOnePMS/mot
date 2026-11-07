import { CheckCircle2, CircleSlash } from 'lucide-react';
import { PRODUCT_NAME } from '@/config/product';

const DONE = {
  payment: { title: 'Payment received', body: 'Thank you. The hotel has your payment.' },
  hold: { title: 'The hold is in place', body: 'Nothing has been charged. The hotel releases the hold at check-out, or charges only what you owe.' },
  deposit: { title: 'Deposit received', body: 'The hotel refunds it at check-out, less anything you owe.' },
};

/**
 * Where Stripe sends whoever paid at the front desk: staff on the desk's device, or the guest on their own
 * phone after scanning the desk's QR code. It shows no booking details (the payer may not be the guest, and
 * the link can be opened by anyone); the desk's screen follows the payment on its own.
 */
export default async function PayDonePage({ searchParams }: { searchParams: Promise<{ cancelled?: string; for?: string }> }) {
  const params = await searchParams;
  const cancelled = params.cancelled === '1';
  const done = DONE[params.for as keyof typeof DONE] ?? DONE.payment;
  return (
    <main id="main" className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-8 text-center">
        {cancelled ? <CircleSlash className="mx-auto size-10 text-muted-foreground" aria-hidden /> : <CheckCircle2 className="mx-auto size-10 text-success" aria-hidden />}
        <h1 className="mt-4 text-xl font-semibold tracking-tight">{cancelled ? 'Nothing was charged' : done.title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {cancelled ? 'The payment was cancelled. Tell the front desk, and they’ll help you pay another way.' : `${done.body} You can close this page.`}
        </p>
        <p className="mt-6 text-xs text-muted-foreground">Sent securely by {PRODUCT_NAME} for the hotel.</p>
      </div>
    </main>
  );
}
