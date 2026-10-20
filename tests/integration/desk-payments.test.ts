import { beforeEach, describe, expect, it, vi } from 'vitest';

// A fake Stripe on the hotel's connected account: just enough for the card reader and the deposit hold.
const stripe = vi.hoisted(() => {
  const intents = new Map<string, Record<string, unknown>>();
  let n = 0;
  return {
    intents,
    reset: () => intents.clear(),
    calls: [] as { fn: string; args: unknown[] }[],
    api: {
      accounts: { retrieve: vi.fn(async () => ({ id: 'acct_hotel', country: 'US' })) },
      paymentIntents: {
        create: vi.fn(async (params: Record<string, unknown>) => {
          const id = `pi_${Date.now().toString(36)}_${++n}`;
          const pi = { id, status: 'requires_payment_method', amount: params.amount, amount_received: 0, amount_capturable: 0, capture_method: params.capture_method, metadata: params.metadata, latest_charge: null };
          intents.set(id, pi);
          return pi;
        }),
        retrieve: vi.fn(async (id: string) => intents.get(id)),
        capture: vi.fn(async (id: string, params: { amount_to_capture: number }) => {
          const pi = intents.get(id)!;
          Object.assign(pi, { status: 'succeeded', amount_received: params.amount_to_capture, amount_capturable: 0 });
          return pi;
        }),
        cancel: vi.fn(async (id: string) => {
          const pi = intents.get(id)!;
          Object.assign(pi, { status: 'canceled', amount_capturable: 0 });
          return pi;
        }),
      },
      terminal: {
        readers: {
          retrieve: vi.fn(async (id: string) => ({ id, label: 'Front desk', location: 'tml_hotel', device_type: 'simulated_wisepos_e', serial_number: 'SIMULATOR', action: null })),
          processPaymentIntent: vi.fn(async (id: string) => ({ id })),
          list: vi.fn(async () => ({ data: [] })),
        },
      },
    },
  };
});
vi.mock('@/lib/stripe', () => ({ getStripe: () => stripe.api, isStripeConfigured: () => true, platformFeePercent: () => 0, webhookSecrets: () => [] }));

import { prisma } from '@/lib/prisma';
import { addDaysISO } from '@/server/dates';
import { applyDeskIntent, getDeskPayments, recordCashPayment, refundCash, settleDeposit, startReaderPayment } from '@/server/payments/desk';
import { getBookingForStaff } from '@/server/services/bookings';
import { createDeskReservation } from '@/server/services/reservations';
import { actorFor, makeHotel, makeUser } from './fixtures';

async function setup(opts: { stripe?: boolean; deposit?: 'NONE' | 'HOLD' | 'CHARGE' } = {}) {
  const h = await makeHotel({ basePrice: 120 });
  await prisma.property.update({
    where: { id: h.property.id },
    data: {
      securityDepositMode: opts.deposit ?? 'NONE',
      securityDepositAmount: opts.deposit && opts.deposit !== 'NONE' ? 200 : 0,
      ...(opts.stripe ? { stripeAccountId: `acct_${h.property.id}`, stripeChargesEnabled: true, stripeTerminalLocationId: 'tml_hotel' } : {}),
    },
  });
  const desk = await makeUser({ role: 'FRONT_DESK', propertyIds: [h.property.id] });
  const actor = await actorFor(desk.id);
  const booking = await createDeskReservation(
    { actor, source: 'classic' },
    { propertyId: h.property.id, roomTypeId: h.roomType.id, checkIn: h.today, checkOut: addDaysISO(h.today, 2), guests: 1, rooms: 1, guest: { firstName: 'Mia', lastName: 'Ortiz' } },
  );
  return { h, actor, op: { actor, source: 'classic' as const }, booking };
}

beforeEach(() => stripe.reset());

describe('cash at the desk', () => {
  it('records cash toward the balance and marks the stay paid', async () => {
    const { actor, op, booking } = await setup();
    const before = await getDeskPayments(actor, booking.id);
    expect(before.balance).toBe(booking.totalPrice);
    expect(before.card.available).toBe(false);

    const half = Math.round((booking.totalPrice / 2) * 100) / 100;
    const row = await recordCashPayment(op, booking.id, { kind: 'PAYMENT', amount: half, tendered: half + 10 });
    expect(row).toMatchObject({ method: 'CASH', status: 'SUCCEEDED', amount: half, cashTendered: half + 10 });
    let summary = await getBookingForStaff(actor, booking.id);
    expect(summary.paymentStatus).toBe('DEPOSIT_PAID');

    await recordCashPayment(op, booking.id, { kind: 'PAYMENT', amount: Math.round((booking.totalPrice - half) * 100) / 100 });
    summary = await getBookingForStaff(actor, booking.id);
    expect(summary.paymentStatus).toBe('PAID');
    expect((await getDeskPayments(actor, booking.id)).balance).toBe(0);
    const history = await prisma.bookingStatusHistory.findMany({ where: { bookingId: booking.id } });
    expect(history.some((h) => /received in cash/.test(h.notes ?? '') && /change given 10\.00/.test(h.notes ?? ''))).toBe(true);
  });

  it('refuses more than the balance and too little cash', async () => {
    const { op, booking } = await setup();
    await expect(recordCashPayment(op, booking.id, { kind: 'PAYMENT', amount: booking.totalPrice + 1 })).rejects.toThrow(/balance/);
    await expect(recordCashPayment(op, booking.id, { kind: 'PAYMENT', amount: 50, tendered: 40 })).rejects.toThrow(/less than/);
  });

  it('keeps a cash deposit out of the balance and hands it back at check-out', async () => {
    const { actor, op, booking } = await setup({ deposit: 'CHARGE' });
    expect((await getDeskPayments(actor, booking.id)).deposit).toMatchObject({ mode: 'CHARGE', amount: 200, due: 200, held: 0 });
    const dep = await recordCashPayment(op, booking.id, { kind: 'SECURITY_DEPOSIT', amount: 200 });
    let state = await getDeskPayments(actor, booking.id);
    expect(state.deposit).toMatchObject({ due: 0, held: 200 });
    expect(state.balance).toBe(booking.totalPrice);
    expect((await getBookingForStaff(actor, booking.id)).paymentStatus).not.toBe('PAID');

    const settled = await settleDeposit(op, dep.id, { keep: 25, note: 'Minibar' });
    expect(settled).toMatchObject({ status: 'PARTIALLY_REFUNDED', amountRefunded: 175 });
    expect(settled.settledAt).not.toBeNull();
    state = await getDeskPayments(actor, booking.id);
    expect(state.deposit).toMatchObject({ due: 0, held: 0 });
    await expect(settleDeposit(op, dep.id, { keep: 0 })).rejects.toThrow(/already/);
  });

  it('hands back cash only for staff who may refund', async () => {
    const { h, op, booking } = await setup();
    const paid = await recordCashPayment(op, booking.id, { kind: 'PAYMENT', amount: 50 });
    await expect(refundCash(op, paid.id, {})).rejects.toThrow(/roles/);
    const manager = await actorFor((await makeUser({ role: 'MANAGER', propertyIds: [h.property.id] })).id);
    const back = await refundCash({ actor: manager, source: 'classic' }, paid.id, { amount: 20 });
    expect(back).toMatchObject({ status: 'PARTIALLY_REFUNDED', amountRefunded: 20 });
  });

  it('keeps other hotels and other roles out', async () => {
    const { booking } = await setup();
    const other = await makeHotel();
    const stranger = await actorFor((await makeUser({ role: 'FRONT_DESK', propertyIds: [other.property.id] })).id);
    await expect(getDeskPayments(stranger, booking.id)).rejects.toThrow(/access/);
    const housekeeper = await actorFor((await makeUser({ role: 'HOUSEKEEPER', propertyIds: [booking.propertyId] })).id);
    await expect(getDeskPayments(housekeeper, booking.id)).rejects.toThrow(/roles/);
  });
});

describe('card reader', () => {
  it('sends the balance to the reader and records it once paid', async () => {
    const { actor, op, booking } = await setup({ stripe: true });
    const started = await startReaderPayment(op, booking.id, { kind: 'PAYMENT', amount: booking.totalPrice, readerId: 'tmr_1' });
    expect(started).toMatchObject({ method: 'TERMINAL', status: 'PENDING' });
    const [params, opts] = stripe.api.paymentIntents.create.mock.calls[0] as unknown as [Record<string, unknown>, Record<string, unknown>];
    expect(params).toMatchObject({ payment_method_types: ['card_present'], capture_method: 'automatic', metadata: { deskPaymentId: started.id } });
    expect(opts.stripeAccount).toBe(`acct_${booking.propertyId}`);
    expect(stripe.api.terminal.readers.processPaymentIntent).toHaveBeenCalled();

    const pi = [...stripe.intents.values()][0];
    Object.assign(pi, {
      status: 'succeeded',
      amount_received: pi.amount,
      latest_charge: { id: `ch_${pi.id}`, amount_refunded: 0, payment_method_details: { card_present: { brand: 'visa', last4: '4242' } }, billing_details: {}, outcome: null },
    });
    // Webhook and polling both deliver it: recorded once.
    await applyDeskIntent(started.id, pi as never, `acct_${booking.propertyId}`);
    await applyDeskIntent(started.id, pi as never, null);
    const state = await getDeskPayments(actor, booking.id);
    expect(state.balance).toBe(0);
    expect(state.payments[0]).toMatchObject({ status: 'SUCCEEDED', cardBrand: 'visa', cardLast4: '4242' });
    expect((await getBookingForStaff(actor, booking.id)).paymentStatus).toBe('PAID');
    const notes = await prisma.bookingStatusHistory.findMany({ where: { bookingId: booking.id, notes: { contains: 'card reader' } } });
    expect(notes).toHaveLength(1);
  });

  it('ignores an event from another hotel’s Stripe account', async () => {
    const { op, booking } = await setup({ stripe: true });
    const started = await startReaderPayment(op, booking.id, { kind: 'PAYMENT', amount: 10, readerId: 'tmr_1' });
    const pi = [...stripe.intents.values()][0];
    Object.assign(pi, { status: 'succeeded', amount_received: pi.amount });
    await applyDeskIntent(started.id, pi as never, 'acct_someone_else');
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: started.id } })).status).toBe('PENDING');
  });

  it('holds the deposit on the card and captures only what is kept', async () => {
    const { actor, op, booking } = await setup({ stripe: true, deposit: 'HOLD' });
    const started = await startReaderPayment(op, booking.id, { kind: 'SECURITY_DEPOSIT', amount: 200, readerId: 'tmr_1' });
    const [params] = stripe.api.paymentIntents.create.mock.calls.at(-1) as unknown as [Record<string, unknown>];
    expect(params).toMatchObject({ capture_method: 'manual', payment_method_options: { card_present: { request_extended_authorization: true } } });
    const pi = stripe.intents.get((await prisma.payment.findUniqueOrThrow({ where: { id: started.id } })).stripePaymentIntentId!)!;
    Object.assign(pi, { status: 'requires_capture', amount_capturable: 20000, latest_charge: { id: `ch_${pi.id}`, amount_refunded: 0, payment_method_details: { card_present: { brand: 'mastercard', last4: '4444', capture_before: Math.floor(Date.now() / 1000) + 30 * 86400 } }, billing_details: {} } });
    await applyDeskIntent(started.id, pi as never, null);
    let state = await getDeskPayments(actor, booking.id);
    expect(state.deposit).toMatchObject({ held: 200, due: 0 });
    expect(state.balance).toBe(booking.totalPrice);
    expect(state.payments[0].captureBefore).not.toBeNull();

    const settled = await settleDeposit(op, started.id, { keep: 30, note: 'Late checkout' });
    expect(stripe.api.paymentIntents.capture).toHaveBeenCalledWith(pi.id, expect.objectContaining({ amount_to_capture: 3000 }), expect.anything());
    expect(settled).toMatchObject({ status: 'SUCCEEDED', amount: 30, amountAuthorized: 200 });
    state = await getDeskPayments(actor, booking.id);
    expect(state.deposit.held).toBe(0);
    // Kept incidentals don't pay for the room.
    expect(state.balance).toBe(booking.totalPrice);
  });
});

describe('OTA cards', () => {
  it('keeps the virtual card for the desk without its number, and charges it on Stripe’s page', async () => {
    const { importReservation } = await import('@/server/channels/reservations');
    const { loadConnection } = await import('@/server/channels/ari');
    const { parseXml } = await import('@/server/channels/xml');
    const { startCardEntry } = await import('@/server/payments/desk');
    const { h, actor, op } = await setup({ stripe: true });
    const conn = await prisma.channelConnection.create({
      data: { propertyId: h.property.id, channel: 'BOOKING_COM', otaPropertyId: '999', roomMappings: { create: { roomTypeId: h.roomType.id, otaRoomTypeId: '99901', otaRatePlanId: '1' } } },
    });
    const raw = parseXml(
      `<HotelReservation><ResGlobalInfo><Guarantee><GuaranteesAccepted><GuaranteeAccepted><PaymentCard CardCode="VI" CardNumber="4111111111111111" SeriesCode="321" ExpireDate="1229" EffectiveDate="${h.today}" CurrentBalance="24000" DecimalPlaces="2" CurrencyCode="USD"/></GuaranteeAccepted></GuaranteesAccepted></Guarantee></ResGlobalInfo></HotelReservation>`,
    );
    const [result] = await importReservation((await loadConnection(conn.id))!, {
      externalId: `BDC-${conn.id}`,
      reservationGroupId: `BDC-${conn.id}`,
      action: 'BOOK',
      otaRoomTypeId: '99901',
      otaRatePlanId: '1',
      checkIn: h.today,
      checkOut: addDaysISO(h.today, 2),
      rooms: 1,
      adults: 2,
      children: 0,
      totalAmount: 240,
      currency: 'USD',
      guest: { firstName: 'Ola', lastName: 'Nord', email: null, phone: null },
      specialRequests: null,
      paymentModel: 'Booking.com',
      raw,
    });
    expect(result.outcome).toBe('created');
    const stored = await prisma.channelReservation.findFirstOrThrow({ where: { connectionId: conn.id } });
    expect(JSON.stringify(stored)).not.toMatch(/4111111111111111|321/);
    expect(stored.paymentCard).toMatchObject({ type: 'VIRTUAL', last4: '1111', balance: 240, chargeableFrom: h.today });

    const state = await getDeskPayments(actor, result.bookingId!);
    expect(state.otaCard).toMatchObject({ channel: 'Booking.com', last4: '1111', chargeable: true });

    const create = vi.fn(async () => ({ id: 'cs_desk', url: 'https://checkout.stripe.com/c/cs_desk' }));
    (stripe.api as Record<string, unknown>).checkout = { sessions: { create } };
    await expect(startCardEntry(op, result.bookingId!, { kind: 'PAYMENT', amount: 240.01, virtualCard: true, siteUrl: 'https://hotelone.site' })).rejects.toThrow(/balance/);
    const page = await startCardEntry(op, result.bookingId!, { kind: 'PAYMENT', amount: 240, virtualCard: true, siteUrl: 'https://hotelone.site' });
    expect(page).toMatchObject({ method: 'VIRTUAL_CARD', status: 'PENDING', url: 'https://checkout.stripe.com/c/cs_desk' });
    const [params] = create.mock.calls[0] as unknown as [Record<string, any>];
    expect(params.metadata.deskPaymentId).toBe(page.id);
    expect(params.payment_intent_data.capture_method).toBe('automatic');
  });
});
