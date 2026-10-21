import { describe, expect, it } from 'vitest';
import { cashChangeCents, containsCardNumber, depositDueCents, depositHeldCents, depositSettlement, deskAmountProblem, type DeskPaymentLike } from '@/lib/desk-payments';
import { extractPaymentCard, redactCardData, virtualCardWindow } from '@/server/channels/cards';
import { maskCardNumbers, parseXml } from '@/server/channels/xml';

const BOOKING_COM_VCC = `<?xml version="1.0"?>
<OTA_HotelResNotifRQ><HotelReservations><HotelReservation>
  <ResGlobalInfo>
    <Guarantee><GuaranteesAccepted><GuaranteeAccepted>
      <PaymentCard CardCode="MC" CardNumber="5555555555554444" SeriesCode="737" ExpireDate="1227" EffectiveDate="2026-11-01" CurrentBalance="10599" DecimalPlaces="2" CurrencyCode="EUR" VCCExpirationDate="2026-12-31">
        <CardHolderName>Booking.com BV</CardHolderName>
      </PaymentCard>
    </GuaranteeAccepted></GuaranteesAccepted></Guarantee>
  </ResGlobalInfo>
</HotelReservation></HotelReservations></OTA_HotelResNotifRQ>`;

const EXPEDIA_GUEST_CARD = `<Booking id="123"><RoomStay roomTypeID="1" ratePlanID="2">
  <PaymentCard cardCode="VI" cardNumber="4111 1111 1111 1111" seriesCode="123" expireDate="0828"><CardHolder name="Ana Lopez"/></PaymentCard>
</RoomStay></Booking>`;

describe('OTA cards', () => {
  it('reads a Booking.com virtual card without its number', () => {
    const card = extractPaymentCard(parseXml(BOOKING_COM_VCC), { channel: 'BOOKING_COM' });
    expect(card).toEqual({
      type: 'VIRTUAL',
      brand: 'Mastercard',
      last4: '4444',
      expiry: '12/27',
      holderName: 'Booking.com BV',
      chargeableFrom: '2026-11-01',
      chargeableUntil: '2026-12-31',
      balance: 105.99,
      currency: 'EUR',
    });
    expect(JSON.stringify(card)).not.toContain('5555555555554444');
  });

  it('tells a guest card (hotel collect) from a virtual card', () => {
    const card = extractPaymentCard(parseXml(EXPEDIA_GUEST_CARD), { channel: 'EXPEDIA' });
    expect(card).toMatchObject({ type: 'GUEST', brand: 'Visa', last4: '1111', expiry: '08/28', holderName: 'Ana Lopez', balance: null });
    // Booking.com rate plans ending in VCC are virtual cards even without the extra attributes.
    const plain = parseXml('<PaymentCard CardCode="VI" CardNumber="4111111111111111" ExpireDate="0828"/>');
    expect(extractPaymentCard(plain, { channel: 'BOOKING_COM', ratePlanId: '1234VCC' })?.type).toBe('VIRTUAL');
    expect(extractPaymentCard({ nothing: true }, { channel: 'EXPEDIA' })).toBeNull();
  });

  it('strips card numbers and security codes from the stored payload', () => {
    const raw = parseXml(BOOKING_COM_VCC);
    const safe = JSON.stringify(redactCardData(raw));
    expect(safe).not.toContain('5555555555554444');
    expect(safe).not.toContain('737');
    expect(safe).toContain('•••• 4444');
    // The original is left untouched (parsing reads it again later).
    expect(JSON.stringify(raw)).toContain('5555555555554444');
    const expedia = JSON.stringify(redactCardData(parseXml(EXPEDIA_GUEST_CARD)));
    expect(expedia).not.toMatch(/4111 1111/);
    expect(expedia).not.toContain('seriesCode');
  });

  it('masks card numbers in logged error bodies', () => {
    expect(maskCardNumbers('<PaymentCard CardNumber="4111111111111111" SeriesCode="123"/>')).toBe('<PaymentCard CardNumber="••••1111" SeriesCode="•••"/>');
    expect(maskCardNumbers('card 4111-1111-1111-1111 ok')).toBe('card ••••1111 ok');
    expect(maskCardNumbers('booking 123456789')).toBe('booking 123456789');
  });

  it('knows when a virtual card can be charged', () => {
    const card = { type: 'VIRTUAL' as const, chargeableFrom: '2026-11-01', chargeableUntil: '2026-12-31' };
    expect(virtualCardWindow(card, '2026-10-31').open).toBe(false);
    expect(virtualCardWindow(card, '2026-11-01')).toEqual({ open: true, reason: null });
    expect(virtualCardWindow(card, '2027-01-01').reason).toMatch(/expired/);
    expect(virtualCardWindow({ ...card, type: 'GUEST' }, '2020-01-01').open).toBe(true);
  });
});

const p = (o: Partial<DeskPaymentLike>): DeskPaymentLike => ({ kind: 'SECURITY_DEPOSIT', status: 'SUCCEEDED', settled: false, amountCents: 0, authorizedCents: null, refundedCents: 0, ...o });

describe('security deposit', () => {
  it('counts holds and charges not yet returned', () => {
    expect(depositHeldCents([p({ status: 'AUTHORIZED', amountCents: 20000, authorizedCents: 20000 }), p({ amountCents: 5000, refundedCents: 1000 }), p({ kind: 'PAYMENT', amountCents: 9999 }), p({ amountCents: 300, settled: true })])).toBe(24000);
  });

  it('asks only for what is still missing, and never again once settled', () => {
    expect(depositDueCents({ mode: 'NONE', amountCents: 20000, payments: [] })).toBe(0);
    expect(depositDueCents({ mode: 'HOLD', amountCents: 20000, payments: [] })).toBe(20000);
    expect(depositDueCents({ mode: 'HOLD', amountCents: 20000, payments: [p({ status: 'AUTHORIZED', amountCents: 5000, authorizedCents: 5000 })] })).toBe(15000);
    expect(depositDueCents({ mode: 'CHARGE', amountCents: 20000, payments: [p({ status: 'CANCELED', amountCents: 0, authorizedCents: 20000, settled: true })] })).toBe(0);
    // A declined attempt doesn't count.
    expect(depositDueCents({ mode: 'CHARGE', amountCents: 20000, payments: [p({ status: 'FAILED', amountCents: 20000 })] })).toBe(20000);
  });

  it('settles a hold by capturing what is kept, or releasing it', () => {
    const hold = { status: 'AUTHORIZED', amountCents: 20000, authorizedCents: 20000, refundedCents: 0 };
    expect(depositSettlement({ ...hold, keepCents: 0 })).toEqual({ action: 'release' });
    expect(depositSettlement({ ...hold, keepCents: 4500 })).toEqual({ action: 'capture', captureCents: 4500 });
    expect(depositSettlement({ ...hold, keepCents: 20001 })).toHaveProperty('error');
  });

  it('settles a charged deposit by refunding the rest', () => {
    const charged = { status: 'SUCCEEDED', amountCents: 20000, authorizedCents: null, refundedCents: 0 };
    expect(depositSettlement({ ...charged, keepCents: 0 })).toEqual({ action: 'refund', refundCents: 20000 });
    expect(depositSettlement({ ...charged, keepCents: 20000 })).toEqual({ action: 'none' });
    expect(depositSettlement({ ...charged, keepCents: -1 })).toHaveProperty('error');
    expect(depositSettlement({ ...charged, status: 'REFUNDED', keepCents: 0 })).toHaveProperty('error');
  });
});

describe('collecting at the desk', () => {
  it('works out the change', () => {
    expect(cashChangeCents(10000, 8250)).toBe(1750);
    expect(cashChangeCents(8250, 8250)).toBe(0);
    expect(cashChangeCents(5000, 8250)).toBeNull();
  });

  it('refuses amounts above the balance or the deposit ceiling', () => {
    expect(deskAmountProblem({ kind: 'PAYMENT', amountCents: 10000, balanceCents: 10000, currency: 'USD' })).toBeNull();
    expect(deskAmountProblem({ kind: 'PAYMENT', amountCents: 10001, balanceCents: 10000, currency: 'USD' })).toMatch(/at most/);
    expect(deskAmountProblem({ kind: 'PAYMENT', amountCents: 100, balanceCents: 0, currency: 'USD' })).toMatch(/Nothing/);
    expect(deskAmountProblem({ kind: 'SECURITY_DEPOSIT', amountCents: 50000, balanceCents: 0, currency: 'USD' })).toBeNull();
    expect(deskAmountProblem({ kind: 'SECURITY_DEPOSIT', amountCents: 0, balanceCents: 0, currency: 'USD' })).toMatch(/Enter/);
  });
});

describe('card numbers typed into notes', () => {
  it('spots a full card number, with or without spaces and dashes', () => {
    expect(containsCardNumber('4242424242424242')).toBe(true);
    expect(containsCardNumber('paid with 4242 4242 4242 4242 at the bar')).toBe(true);
    expect(containsCardNumber('3782-822463-10005')).toBe(true);
  });
  it('spots one next to other digits: an expiry, a reference, a room number', () => {
    expect(containsCardNumber('Guest pays later, card 4111 1111 1111 1111 12 26')).toBe(true);
    expect(containsCardNumber('4111 1111 1111 1111 12/26')).toBe(true);
    expect(containsCardNumber('Wrong card 4111 1111 1111 1111 1226 charged')).toBe(true);
    expect(containsCardNumber('Comp, PO 1234 4111 1111 1111 1111')).toBe(true);
    expect(containsCardNumber('2 4111111111111111')).toBe(true);
    expect(containsCardNumber('Room 204 4111 1111 1111 1111')).toBe(true);
    expect(containsCardNumber('41111111111111111226')).toBe(true);
  });
  it('leaves approval codes, phone numbers and amounts alone', () => {
    expect(containsCardNumber('A1B2C3')).toBe(false);
    expect(containsCardNumber('Bank transfer ref 20261021')).toBe(false);
    expect(containsCardNumber('+1 831 555 0100')).toBe(false);
    // 16 digits that fail the Luhn check aren't a card number.
    expect(containsCardNumber('4242424242424241')).toBe(false);
    expect(containsCardNumber(null)).toBe(false);
  });
});
