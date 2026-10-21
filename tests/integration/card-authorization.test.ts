import { describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { addDaysISO, atNoonUTC } from '@/server/dates';
import {
  cancelCardAuthorization,
  getAuthorizationForm,
  listCardAuthorizations,
  purgeExpiredIdPhotos,
  readIdPhoto,
  renewCardAuthorizationLink,
  requestCardAuthorization,
  reviewCardAuthorization,
  submitCardAuthorization,
  verifiedAuthorizationFor,
  type AuthorizationSubmission,
} from '@/server/payments/cardAuthorization';
import { refreshEvidence } from '@/server/payments/disputes';
import { renderEvidenceText } from '@/server/payments/evidence';
import { actorFor, makeHotel, makeUser, uid } from './fixtures';

const ORIGIN = 'https://hotel.test';
// 1×1 PNG, and the start of a JPEG (only the first bytes are checked).
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 1, 2, 3, 4]);
const JPEG = `data:image/jpeg;base64,${JPEG_BYTES.toString('base64')}`;

let ipSeq = 0;
const meta = () => ({ ip: `198.51.100.${(ipSeq++ % 200) + 1}-${uid()}`, userAgent: 'vitest' });

/** A confirmed stay for Jamie Smith, paid online by Pat Jones's Visa ending 4242 (or not paid online). */
async function paidStay(opts: { paid?: boolean; checkOutDaysAgo?: number } = {}) {
  const h = await makeHotel();
  const desk = await makeUser({ role: 'FRONT_DESK', propertyIds: [h.property.id] });
  const guest = await prisma.user.create({ data: { email: `jamie-${uid()}@example.org`, password: '', firstName: 'Jamie', lastName: 'Smith', role: 'CUSTOMER' } });
  const checkIn = opts.checkOutDaysAgo ? addDaysISO(h.today, -opts.checkOutDaysAgo - 2) : addDaysISO(h.today, 3);
  const checkOut = addDaysISO(checkIn, 2);
  const booking = await prisma.booking.create({
    data: {
      userId: guest.id,
      propertyId: h.property.id,
      roomTypeId: h.roomType.id,
      checkIn: atNoonUTC(checkIn),
      checkOut: atNoonUTC(checkOut),
      guests: 2,
      rooms: 1,
      totalPrice: 230,
      subtotalPrice: 200,
      status: 'CONFIRMED',
      code: `A${uid().toUpperCase()}`,
      paymentStatus: opts.paid === false ? 'UNPAID' : 'PAID',
    },
  });
  if (opts.paid !== false) {
    await prisma.payment.create({
      data: {
        bookingId: booking.id,
        propertyId: h.property.id,
        stripePaymentIntentId: `pi_${uid()}${uid()}`,
        status: 'SUCCEEDED',
        amount: 230,
        currency: 'usd',
        cardholderName: 'Pat Jones',
        billingEmail: 'pat@example.org',
        billingCountry: 'US',
        cardCountry: 'US',
        cardBrand: 'visa',
        cardLast4: '4242',
        threeDSecure: 'authenticated',
        riskLevel: 'normal',
        paidAt: new Date(),
      },
    });
  }
  const actor = await actorFor(desk.id);
  return { h, desk, guest, booking, actor, ctx: { actor, source: 'classic' as const } };
}

const tokenOf = (url: string) => url.split('/authorize/')[1];

async function submission(token: string, over: Partial<AuthorizationSubmission> = {}): Promise<AuthorizationSubmission> {
  const form = await getAuthorizationForm(token);
  return {
    textHash: form.form!.textHash,
    name: 'Pat Jones',
    email: 'pat@example.org',
    phone: '+1 617 555 0123',
    billing: { line1: '9 Elm St', city: 'Boston', postalCode: '02110', country: 'US' },
    card: { last4: '4242' },
    id: { type: 'DRIVERS_LICENSE', country: 'US', last4: '7781', photo: JPEG },
    signature: { method: 'DRAWN', image: PNG },
    ...over,
  };
}

describe('card authorization (someone else pays)', () => {
  it('sends a link, the cardholder signs with matching card digits and ID, and staff verify it', async () => {
    const s = await paidStay();
    const overview = await listCardAuthorizations(s.actor, s.booking.id);
    // The payer is prefilled because Stripe's cardholder isn't the guest.
    expect(overview.defaults).toMatchObject({ cardholderName: 'Pat Jones', cardholderEmail: 'pat@example.org', guestNames: ['Jamie Smith'], amount: 230, card: { brand: 'visa', last4: '4242' } });
    expect(overview.idPhotos).toBe(true);

    const issued = await requestCardAuthorization(s.ctx, s.booking.id, { cardholderName: 'Pat Jones', cardholderEmail: 'pat@example.org', guestNames: ['Jamie Smith'], coversIncidentals: true, incidentalsLimit: 150, sendEmail: false }, ORIGIN);
    expect(issued.url).toMatch(/^https:\/\/hotel\.test\/authorize\/[A-Za-z0-9_-]{40,}$/);
    expect(issued.authorization.status).toBe('PENDING');
    const stored = await prisma.cardAuthorization.findUniqueOrThrow({ where: { id: issued.authorization.id } });
    // Only a hash of the token is kept.
    expect(stored.tokenHash).not.toContain(tokenOf(issued.url));

    const form = await getAuthorizationForm(tokenOf(issued.url));
    expect(form.status).toBe('PENDING');
    expect(form.form).toMatchObject({ cardholderName: 'Pat Jones', guestNames: ['Jamie Smith'], amount: 230, paidCard: { brand: 'visa' }, attemptsLeft: 5, idPhotoRequired: true });
    expect(form.form!.text).toContain('the Visa card used to pay for this reservation');
    expect(form.form!.text).toContain('up to $150.00');
    // The form never shows the card's digits (the cardholder proves them).
    expect(JSON.stringify(form)).not.toContain('4242');

    const body = await submission(tokenOf(issued.url));
    const result = await submitCardAuthorization(tokenOf(issued.url), body, meta());
    expect(result.status).toBe('SIGNED');

    const signed = (await listCardAuthorizations(s.actor, s.booking.id)).authorizations[0];
    expect(signed.status).toBe('SIGNED');
    expect(signed.signed).toMatchObject({ name: 'Pat Jones', card: { brand: 'visa', last4: '4242' }, id: { type: 'DRIVERS_LICENSE', country: 'US', last4: '7781', photo: true }, signature: { method: 'DRAWN', image: PNG } });
    expect(signed.signed!.documentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(signed.outcome).toBe('MATCH');
    expect(signed.checks.map((c) => [c.key, c.result])).toEqual([
      ['CARD_DIGITS', 'MATCH'],
      ['NAME_ON_CARD', 'MATCH'],
      ['NAME_EXPECTED', 'MATCH'],
      ['BILLING_COUNTRY', 'MATCH'],
      ['BILLING_EMAIL', 'MATCH'],
    ]);

    // The ID photo is sealed at rest and comes back intact for staff (and the view is logged).
    const sealed = await prisma.cardAuthorizationIdPhoto.findUniqueOrThrow({ where: { authorizationId: signed.id } });
    expect(sealed.cipher).not.toContain(JPEG_BYTES.toString('base64'));
    const photo = await readIdPhoto(s.ctx, signed.id);
    expect(photo.mime).toBe('image/jpeg');
    expect(photo.bytes.equals(JPEG_BYTES)).toBe(true);
    expect(await prisma.agentAuditLog.count({ where: { propertyId: s.h.property.id, action: 'CARD_AUTH_ID_VIEWED' } })).toBe(1);
    // Guests read the status history on their booking page: nothing about the payer goes there.
    expect(await prisma.bookingStatusHistory.count({ where: { bookingId: s.booking.id } })).toBe(0);

    // The link can't be used twice.
    await expect(submitCardAuthorization(tokenOf(issued.url), body, meta())).rejects.toMatchObject({ status: 410, code: 'LINK_CLOSED' });
    expect((await getAuthorizationForm(tokenOf(issued.url))).form).toBeNull();

    expect(await verifiedAuthorizationFor(s.booking)).toBeNull();
    const verified = await reviewCardAuthorization(s.ctx, signed.id, { decision: 'VERIFY' });
    expect(verified.status).toBe('VERIFIED');
    expect(verified.review?.by).toBe(s.actor.name);
    expect((await verifiedAuthorizationFor(s.booking))?.signerName).toBe('Pat Jones');
    await expect(reviewCardAuthorization(s.ctx, signed.id, { decision: 'REJECT', note: 'x' })).rejects.toThrow(/waiting for review/);
  });

  it('locks the link after five wrong card digits', async () => {
    const s = await paidStay();
    const { url } = await requestCardAuthorization(s.ctx, s.booking.id, { cardholderName: 'Pat Jones', guestNames: ['Jamie Smith'], coversIncidentals: false, sendEmail: false }, ORIGIN);
    const token = tokenOf(url);
    const wrong = await submission(token, { card: { last4: '1111' } });
    for (let left = 4; left >= 1; left--) {
      await expect(submitCardAuthorization(token, wrong, meta())).rejects.toThrow(new RegExp(`${left} tr(y|ies) left`));
    }
    await expect(submitCardAuthorization(token, wrong, meta())).rejects.toMatchObject({ status: 410, code: 'LINK_LOCKED' });
    expect((await getAuthorizationForm(token)).status).toBe('LOCKED');
    expect(await prisma.agentAuditLog.count({ where: { propertyId: s.h.property.id, action: 'CARD_AUTH_LOCKED' } })).toBe(1);
  });

  it('without an online payment the cardholder names the card, and the digits are left for the desk to check', async () => {
    const s = await paidStay({ paid: false });
    const { url } = await requestCardAuthorization(s.ctx, s.booking.id, { cardholderName: 'Pat Jones', guestNames: ['Jamie Smith'], coversIncidentals: false, sendEmail: false }, ORIGIN);
    const token = tokenOf(url);
    expect((await getAuthorizationForm(token)).form!.paidCard).toBeNull();
    await expect(submitCardAuthorization(token, await submission(token, { card: { last4: '1005' } }), meta())).rejects.toThrow(/type of card/);
    await submitCardAuthorization(token, await submission(token, { card: { brand: 'amex', last4: '1005' }, signature: { method: 'TYPED', text: 'pat jones' } }), meta());
    const a = (await listCardAuthorizations(s.actor, s.booking.id)).authorizations[0];
    expect(a.signed?.card).toEqual({ brand: 'amex', last4: '1005' });
    expect(a.signed?.signature).toEqual({ method: 'TYPED', image: null });
    expect(a.checks.map((c) => [c.key, c.result])).toEqual([
      ['CARD_DIGITS', 'UNVERIFIED'],
      ['NAME_EXPECTED', 'MATCH'],
    ]);
  });

  it('refuses a typed signature that isn’t the signer’s name, a stale wording and a fake image', async () => {
    const s = await paidStay();
    const { url } = await requestCardAuthorization(s.ctx, s.booking.id, { cardholderName: 'Pat Jones', guestNames: ['Jamie Smith'], coversIncidentals: false, sendEmail: false }, ORIGIN);
    const token = tokenOf(url);
    await expect(submitCardAuthorization(token, await submission(token, { signature: { method: 'TYPED', text: 'PJ' } }), meta())).rejects.toThrow(/full name/);
    await expect(submitCardAuthorization(token, await submission(token, { textHash: 'a'.repeat(64) }), meta())).rejects.toMatchObject({ status: 409 });
    const notAnImage = `data:image/jpeg;base64,${Buffer.from('<script>alert(1)</script>').toString('base64')}`;
    await expect(submitCardAuthorization(token, await submission(token, { id: { type: 'PASSPORT', country: 'US', last4: 'X123', photo: notAnImage } }), meta())).rejects.toThrow(/valid image/);
    await expect(submitCardAuthorization(token, await submission(token, { id: { type: 'PASSPORT', country: 'US', last4: 'X123', photo: null } }), meta())).rejects.toThrow(/photo of your ID/);
    // None of that used up the card-digit tries.
    expect((await getAuthorizationForm(token)).form!.attemptsLeft).toBe(5);
  });

  it('a new request or link replaces the old one; cancelled links stop working', async () => {
    const s = await paidStay();
    const req = { cardholderName: 'Pat Jones', guestNames: ['Jamie Smith'], coversIncidentals: false, sendEmail: false };
    const first = await requestCardAuthorization(s.ctx, s.booking.id, req, ORIGIN);
    const second = await requestCardAuthorization(s.ctx, s.booking.id, req, ORIGIN);
    expect((await getAuthorizationForm(tokenOf(first.url))).status).toBe('CANCELLED');

    const renewed = await renewCardAuthorizationLink(s.ctx, second.authorization.id, { sendEmail: false }, ORIGIN);
    expect(renewed.url).not.toBe(second.url);
    await expect(getAuthorizationForm(tokenOf(second.url))).rejects.toThrow(/not found/);
    expect((await getAuthorizationForm(tokenOf(renewed.url))).status).toBe('PENDING');

    await cancelCardAuthorization(s.ctx, second.authorization.id);
    await expect(submitCardAuthorization(tokenOf(renewed.url), {} as AuthorizationSubmission, meta())).rejects.toMatchObject({ status: 410, code: 'LINK_CLOSED' });
    await expect(renewCardAuthorizationLink(s.ctx, second.authorization.id, { sendEmail: false }, ORIGIN)).rejects.toThrow(/hasn’t been signed/);
  });

  it('keeps staff out of other hotels’ authorizations and needs a reason to reject', async () => {
    const mine = await paidStay();
    const other = await makeHotel();
    const stranger = await actorFor((await makeUser({ role: 'MANAGER', propertyIds: [other.property.id] })).id);
    const housekeeper = await actorFor((await makeUser({ role: 'HOUSEKEEPER', propertyIds: [mine.h.property.id] })).id);
    const { url, authorization } = await requestCardAuthorization(mine.ctx, mine.booking.id, { cardholderName: 'Pat Jones', guestNames: ['Jamie Smith'], coversIncidentals: false, sendEmail: false }, ORIGIN);
    await expect(listCardAuthorizations(stranger, mine.booking.id)).rejects.toThrow(/access/);
    await expect(listCardAuthorizations(housekeeper, mine.booking.id)).rejects.toThrow(/roles/);
    await expect(cancelCardAuthorization({ actor: stranger, source: 'classic' }, authorization.id)).rejects.toThrow(/access/);
    await submitCardAuthorization(tokenOf(url), await submission(tokenOf(url)), meta());
    await expect(readIdPhoto({ actor: stranger, source: 'classic' }, authorization.id)).rejects.toThrow(/access/);
    await expect(reviewCardAuthorization(mine.ctx, authorization.id, { decision: 'REJECT', note: ' ' })).rejects.toThrow(/why/);
    const rejected = await reviewCardAuthorization(mine.ctx, authorization.id, { decision: 'REJECT', note: 'Photo on the ID is someone else' });
    expect(rejected.review).toMatchObject({ decision: 'REJECTED', note: 'Photo on the ID is someone else' });
  });

  it('deletes ID photos after the retention period, unless a dispute is open', async () => {
    const old = await paidStay({ checkOutDaysAgo: 400 });
    const disputed = await paidStay({ checkOutDaysAgo: 400 });
    for (const s of [old, disputed]) {
      const { url } = await requestCardAuthorization(s.ctx, s.booking.id, { cardholderName: 'Pat Jones', guestNames: ['Jamie Smith'], coversIncidentals: false, sendEmail: false }, ORIGIN);
      await submitCardAuthorization(tokenOf(url), await submission(tokenOf(url)), meta());
    }
    await prisma.dispute.create({ data: { stripeDisputeId: `dp_${uid()}`, bookingId: disputed.booking.id, propertyId: disputed.h.property.id, amount: 230, status: 'under_review' } });
    await purgeExpiredIdPhotos();
    const [a] = (await listCardAuthorizations(old.actor, old.booking.id)).authorizations;
    expect(a.signed?.id.photo).toBe(false);
    expect(a.signed?.id.photoPurgedAt).not.toBeNull();
    // Everything else stays as signed.
    expect(a.signed?.documentHash).toMatch(/^[0-9a-f]{64}$/);
    await expect(readIdPhoto(old.ctx, a.id)).rejects.toThrow(/retention/);
    expect((await listCardAuthorizations(disputed.actor, disputed.booking.id)).authorizations[0].signed?.id.photo).toBe(true);
  });

  it('puts the signed authorization into dispute evidence', async () => {
    const s = await paidStay();
    const { url, authorization } = await requestCardAuthorization(s.ctx, s.booking.id, { cardholderName: 'Pat Jones', guestNames: ['Jamie Smith'], coversIncidentals: false, sendEmail: false }, ORIGIN);
    await submitCardAuthorization(tokenOf(url), await submission(tokenOf(url)), meta());
    await reviewCardAuthorization(s.ctx, authorization.id, { decision: 'VERIFY' });
    const dispute = await prisma.dispute.create({ data: { stripeDisputeId: `dp_${uid()}`, bookingId: s.booking.id, propertyId: s.h.property.id, amount: 230, status: 'needs_response', reason: 'fraudulent' } });
    const built = await refreshEvidence(dispute.id);
    const text = renderEvidenceText(built!.summary);
    expect(text).toContain('CARDHOLDER AUTHORIZATION');
    expect(text).toContain('Signed by the cardholder Pat Jones');
    expect(text).toContain('Visa ending 4242 (the last four digits entered match the card that paid)');
    expect(text).toContain('Driver’s license issued in United States, number ending 7781; a photo of the ID is kept by the hotel');
    expect(text).toContain(`verified by ${s.actor.name}`);
    expect(text).toContain('Guests the cardholder authorized: Jamie Smith');
  });
});
