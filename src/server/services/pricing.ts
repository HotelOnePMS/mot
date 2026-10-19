/**
 * Taxes and fees on a stay. Pure: the quote (services/inventory.ts) passes
 * the nightly room prices and the hotel's active charges, and gets back the
 * lines a guest sees and the total the booking stores and Stripe charges.
 *
 *   PERCENT          amount% of the room charges (VAT, sales tax)
 *   PER_ROOM_NIGHT   amount × rooms × nights (resort fee)
 *   PER_GUEST_NIGHT  amount × guests × nights (city tax)
 *   PER_STAY         amount × rooms, once (cleaning fee)
 *
 * Each line is rounded to the currency's minor unit, so the lines always add
 * up to exactly what is charged.
 */
import type { ChargeKind } from '@prisma/client';
import type { QuoteCharge } from '@/lib/dto';
import { roundMoney } from '@/lib/currency';

export interface ChargeRule {
  name: string;
  kind: ChargeKind;
  /** A percentage for PERCENT, otherwise an amount in the hotel's currency. */
  amount: number;
}

export interface PricedStay {
  /** Room charges for every room and night. */
  subtotal: number;
  charges: QuoteCharge[];
  chargesTotal: number;
  total: number;
}

export function priceStay(input: { nightly: number[]; rooms: number; guests: number; charges: ChargeRule[]; currency: string }): PricedStay {
  const { nightly, rooms, guests, currency } = input;
  const nights = nightly.length;
  const subtotal = roundMoney(nightly.reduce((s, p) => s + p, 0) * rooms, currency);
  const charges: QuoteCharge[] = [];
  for (const c of input.charges) {
    const rate = Number(c.amount);
    if (!Number.isFinite(rate) || rate <= 0) continue;
    const raw =
      c.kind === 'PERCENT' ? (subtotal * rate) / 100
      : c.kind === 'PER_ROOM_NIGHT' ? rate * rooms * nights
      : c.kind === 'PER_GUEST_NIGHT' ? rate * guests * nights
      : rate * rooms;
    const amount = roundMoney(raw, currency);
    if (amount > 0) charges.push({ name: c.name, kind: c.kind, rate, amount });
  }
  const chargesTotal = roundMoney(charges.reduce((s, c) => s + c.amount, 0), currency);
  return { subtotal, charges, chargesTotal, total: roundMoney(subtotal + chargesTotal, currency) };
}

/** How a charge reads to a guest: "City tax · $3.50 per guest per night". */
export function describeCharge(c: { kind: ChargeKind; rate: number }, format: (n: number) => string): string {
  switch (c.kind) {
    case 'PERCENT':
      return `${Number(c.rate.toFixed(3))}% of the room price`;
    case 'PER_ROOM_NIGHT':
      return `${format(c.rate)} per room per night`;
    case 'PER_GUEST_NIGHT':
      return `${format(c.rate)} per guest per night`;
    case 'PER_STAY':
      return `${format(c.rate)} per room per stay`;
  }
}
