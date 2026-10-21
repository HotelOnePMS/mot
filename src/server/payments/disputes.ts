/**
 * Card disputes (chargebacks). When Stripe tells us a payment was disputed we
 * record it, assemble the evidence from our own records, and email the hotel's
 * owner. The hotel reviews the evidence in the console and submits it with an
 * explicit click: nothing is ever sent to Stripe or the bank automatically.
 */
import type Stripe from 'stripe';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getStripe } from '@/lib/stripe';
import { fromCents, toCents } from '@/lib/payments';
import { assertPropertyAccess, requireStaff, scopeByProperty } from '../authz';
import { badRequest, notFound } from '../errors';
import { sendDisputeAlert } from '../email';
import { publicSiteUrl } from '../public-url';
import { recordAudit } from '../services/audit';
import { bookingInclude, toBookingSummary } from '../services/mappers';
import { cardBrandLabel, countryName, ID_TYPE_LABEL, type CardAuthCheck, type IdType } from '@/lib/card-authorization';
import { METHOD_LABEL, type PaymentMethod } from '@/lib/desk-payments';
import { buildEvidenceSummary, renderEvidenceText, stripeEvidenceFields, type EvidenceInput, type EvidenceSummary } from './evidence';
import { paymentLines, restorePaymentStatus } from './record';

const OPEN_STATUSES = ['needs_response', 'warning_needs_response'];

const CHECKLIST_LABELS = { idMatched: 'ID matches guest', cardShown: 'Card shown', registrationSigned: 'Registration signed' } as const;

/** Everything we know about the booking, in the shape the evidence builder wants. */
async function loadEvidenceInput(bookingId: string, dispute: { stripeId: string; reason: string | null; amount: number; currency: string }): Promise<EvidenceInput | null> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      ...bookingInclude,
      property: { select: { id: true, name: true, address: true, city: true, state: true, zipCode: true, phone: true, email: true } },
      payments: { where: { status: { in: ['SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED'] } }, orderBy: { createdAt: 'asc' } },
      policyAcceptance: true,
      checklist: true,
      statusHistory: { orderBy: { createdAt: 'asc' } },
      // Someone else paid: the cardholder's signed authorizations (the ID photo itself stays with the hotel).
      cardAuthorizations: {
        where: { status: { in: ['SIGNED', 'VERIFIED'] } },
        orderBy: { signedAt: 'asc' },
        select: {
          signedAt: true,
          signerName: true,
          signerEmail: true,
          signerPhone: true,
          billingAddress: true,
          signerCardBrand: true,
          signerCardLast4: true,
          cardLast4: true,
          idType: true,
          idCountry: true,
          idLast4: true,
          signatureMethod: true,
          guestNames: true,
          checks: true,
          signedIp: true,
          signedUserAgent: true,
          status: true,
          reviewedAt: true,
          reviewedById: true,
          textVersion: true,
          textHash: true,
          documentHash: true,
          text: true,
          idPhoto: { select: { authorizationId: true } },
        },
      },
    },
  });
  if (!booking) return null;
  const summary = toBookingSummary(booking);
  // Security deposits taken at the desk (held, kept, returned or a hold released), on any line of the reservation.
  const deposits = await prisma.payment.findMany({
    where: {
      kind: 'SECURITY_DEPOSIT',
      OR: [{ status: { notIn: ['PENDING', 'FAILED', 'CANCELED'] } }, { status: 'CANCELED', settledAt: { not: null } }],
      booking: booking.groupCode ? { groupCode: booking.groupCode } : { id: booking.id },
    },
    orderBy: { createdAt: 'asc' },
    select: { method: true, status: true, amount: true, amountAuthorized: true, amountRefunded: true, currency: true, cardBrand: true, cardLast4: true, settledAt: true, createdAt: true },
  });
  // One payment covers every room type of a reservation: the evidence describes them all, and each room type is
  // checked in on its own line (with its own photo ID and registration card).
  const lines = booking.groupCode ? await paymentLines(booking) : null;
  const lineIds = lines ? lines.map((l) => l.id) : [booking.id];
  const [guestIds, cards] = await Promise.all([
    prisma.guestIdentification.findMany({
      where: { bookingId: { in: lineIds } },
      select: { bookingId: true, idType: true, idCountry: true, idLast4: true, nameOnId: true, nameMatched: true, confirmedById: true, createdAt: true, photo: { select: { guestIdentificationId: true } } },
    }),
    prisma.registrationCard.findMany({ where: { bookingId: { in: lineIds } } }),
  ]);
  const recordLines = lineIds.filter((id) => guestIds.some((g) => g.bookingId === id) || cards.some((c) => c.bookingId === id));
  // The checklist rows: the guided check-in's records count as done, as on the reservation page (checklist.ts).
  const ownId = guestIds.find((g) => g.bookingId === booking.id) ?? guestIds[0] ?? null;
  const ownCard = cards.find((c) => c.bookingId === booking.id) ?? cards[0] ?? null;
  const staffIds = [
    ...(booking.checklist ? [booking.checklist.idMatchedById, booking.checklist.cardShownById, booking.checklist.registrationSignedById] : []),
    ...booking.cardAuthorizations.map((a) => a.reviewedById),
    ...guestIds.map((g) => g.confirmedById),
    ...cards.map((c) => c.witnessedById),
  ].filter((id): id is string => !!id);
  const staff = staffIds.length ? await prisma.user.findMany({ where: { id: { in: staffIds } }, select: { id: true, firstName: true, lastName: true } }) : [];
  const nameOf = (id: string | null) => {
    const u = staff.find((s) => s.id === id);
    return u ? `${u.firstName} ${u.lastName}`.trim() : null;
  };
  const c = booking.checklist;
  const lastWith = (status: string) => [...booking.statusHistory].reverse().find((h) => h.status === status)?.createdAt.toISOString() ?? null;
  const p = booking.property;
  return {
    generatedAt: new Date().toISOString(),
    hotel: { name: p.name, address: `${p.address}, ${p.city}, ${p.state} ${p.zipCode}`, phone: p.phone, email: p.email },
    guest: { name: summary.guest.name, email: summary.guest.email, phone: summary.guest.phone },
    booking: {
      code: summary.code,
      status: booking.status,
      checkIn: summary.checkIn,
      checkOut: summary.checkOut,
      nights: summary.nights,
      rooms: lines ? lines.reduce((n, l) => n + l.rooms, 0) : booking.rooms,
      guests: lines ? lines.reduce((n, l) => n + l.guests, 0) : booking.guests,
      roomType: lines ? lines.map((l) => `${l.rooms} × ${l.roomType.name}`).join(', ') : summary.roomType.name,
      totalPrice: lines ? fromCents(lines.reduce((n, l) => n + toCents(Number(l.totalPrice)), 0)) : summary.totalPrice,
      createdAt: booking.createdAt.toISOString(),
      notes: booking.notes,
    },
    payments: booking.payments.map((x) => ({
      amount: Number(x.amount),
      currency: x.currency,
      status: x.status,
      paidAt: x.paidAt?.toISOString() ?? null,
      cardholderName: x.cardholderName,
      billingEmail: x.billingEmail,
      billingCountry: x.billingCountry,
      cardCountry: x.cardCountry,
      cardBrand: x.cardBrand,
      cardLast4: x.cardLast4,
      threeDSecure: x.threeDSecure,
      riskLevel: x.riskLevel,
    })),
    policy: booking.policyAcceptance
      ? {
          version: booking.policyAcceptance.version,
          hash: booking.policyAcceptance.hash,
          text: booking.policyAcceptance.text,
          acceptedAt: booking.policyAcceptance.acceptedAt.toISOString(),
          ip: booking.policyAcceptance.ip,
          userAgent: booking.policyAcceptance.userAgent,
        }
      : null,
    stay: { checkedInAt: lastWith('CHECKED_IN'), roomNumber: booking.room?.roomNumber ?? null, checkedOutAt: lastWith('CHECKED_OUT') },
    checklist: c
      ? [
          c.idMatchedAt || !ownId
            ? { item: CHECKLIST_LABELS.idMatched, at: c.idMatchedAt?.toISOString() ?? null, by: nameOf(c.idMatchedById) }
            : { item: CHECKLIST_LABELS.idMatched, at: ownId.createdAt.toISOString(), by: nameOf(ownId.confirmedById) },
          { item: CHECKLIST_LABELS.cardShown, at: c.cardShownAt?.toISOString() ?? null, by: nameOf(c.cardShownById) },
          c.registrationSignedAt || !ownCard
            ? { item: CHECKLIST_LABELS.registrationSigned, at: c.registrationSignedAt?.toISOString() ?? null, by: nameOf(c.registrationSignedById) }
            : { item: CHECKLIST_LABELS.registrationSigned, at: ownCard.signedAt.toISOString(), by: nameOf(ownCard.witnessedById) },
        ]
      : [],
    authorizations: booking.cardAuthorizations.map((a) => {
      const addr = a.billingAddress as { line1?: string; city?: string; postalCode?: string; country?: string } | null;
      return {
        signedAt: a.signedAt?.toISOString() ?? '',
        signerName: a.signerName ?? '',
        email: a.signerEmail,
        phone: a.signerPhone,
        billingAddress: addr ? [addr.line1, [addr.city, addr.postalCode].filter(Boolean).join(' '), addr.country ? countryName(addr.country) : null].filter(Boolean).join(', ') : null,
        card: `${cardBrandLabel(a.signerCardBrand)} ending ${a.signerCardLast4 ?? '????'}`,
        cardMatchesPayment: !!a.cardLast4 && a.cardLast4 === a.signerCardLast4,
        idDocument: `${ID_TYPE_LABEL[a.idType as IdType] ?? a.idType ?? 'ID'}${a.idCountry ? ` issued in ${countryName(a.idCountry)}` : ''}${a.idLast4 ? `, number ending ${a.idLast4}` : ''}`,
        idPhotoKept: !!a.idPhoto,
        signatureMethod: a.signatureMethod,
        guestNames: a.guestNames,
        checks: ((a.checks as unknown as CardAuthCheck[] | null) ?? []).map((c) => ({ label: c.label, result: c.result })),
        ip: a.signedIp,
        userAgent: a.signedUserAgent,
        review: a.status === 'VERIFIED' && a.reviewedAt ? `ID checked and verified by ${nameOf(a.reviewedById) ?? 'staff'} on ${a.reviewedAt.toISOString().replace('T', ' ').replace(/:\d{2}\.\d+Z$/, ' UTC')}` : 'Signed; not yet reviewed by staff',
        textVersion: a.textVersion,
        textHash: a.textHash,
        documentHash: a.documentHash,
        text: a.text,
      };
    }),
    checkIn: {
      records: recordLines.map((lineId) => {
        const gid = guestIds.find((g) => g.bookingId === lineId);
        const card = cards.find((x) => x.bookingId === lineId);
        return {
          roomType: lines ? (lines.find((l) => l.id === lineId)?.roomType.name ?? null) : null,
          id: gid
            ? `${ID_TYPE_LABEL[gid.idType as IdType] ?? gid.idType}${gid.idCountry ? ` issued in ${countryName(gid.idCountry)}` : ''}, number ending ${gid.idLast4}, name on ID ${gid.nameOnId} (${gid.nameMatched ? 'matches the booking' : 'differs from the booking name; accepted by staff'})`
            : null,
          idCheckedAt: gid?.createdAt.toISOString() ?? null,
          idCheckedBy: nameOf(gid?.confirmedById ?? null),
          idPhotoKept: !!gid?.photo,
          registration: card
            ? {
                signedAt: card.signedAt.toISOString(),
                signatureMethod: card.signatureMethod,
                ip: card.signedIp,
                witnessedBy: nameOf(card.witnessedById),
                textVersion: card.textVersion,
                textHash: card.textHash,
                documentHash: card.documentHash,
                text: card.text,
              }
            : null,
        };
      }),
      deposits: deposits.map((d) => {
        const held = d.status === 'AUTHORIZED' ? 'held on the card' : d.status === 'CANCELED' ? 'released' : d.settledAt ? 'settled' : 'held';
        const kept = d.settledAt && ['SUCCEEDED', 'PARTIALLY_REFUNDED'].includes(d.status) ? Number(d.amount) - Number(d.amountRefunded) : 0;
        return `${METHOD_LABEL[d.method as PaymentMethod] ?? d.method}, ${Number(d.amountAuthorized ?? d.amount).toFixed(2)} ${d.currency.toUpperCase()}${d.cardLast4 ? ` on ${cardBrandLabel(d.cardBrand)} ending ${d.cardLast4}` : ''}, taken ${d.createdAt.toISOString().slice(0, 10)}; ${held}${kept > 0 ? ` (${kept.toFixed(2)} kept for incidentals)` : ''}`;
      }),
    },
    riskFlags: summary.riskFlags,
    history: booking.statusHistory.map((h) => ({ status: h.status, notes: h.notes, at: h.createdAt.toISOString() })),
    dispute,
  };
}

/** Rebuild and store the evidence summary for a dispute (while it still needs a response). */
export async function refreshEvidence(disputeId: string): Promise<{ summary: EvidenceSummary; input: EvidenceInput } | null> {
  const d = await prisma.dispute.findUnique({ where: { id: disputeId } });
  if (!d?.bookingId) return null;
  const input = await loadEvidenceInput(d.bookingId, { stripeId: d.stripeDisputeId, reason: d.reason, amount: Number(d.amount), currency: d.currency });
  if (!input) return null;
  const summary = buildEvidenceSummary(input);
  await prisma.dispute.update({ where: { id: d.id }, data: { evidenceSummary: summary as unknown as Prisma.InputJsonValue } });
  return { summary, input };
}

async function ownerEmails(propertyId: string): Promise<string[]> {
  const [owners, property] = await Promise.all([
    prisma.user.findMany({ where: { isActive: true, role: 'OWNER', assignedProperties: { some: { propertyId } } }, select: { email: true } }),
    prisma.property.findUnique({ where: { id: propertyId }, select: { email: true } }),
  ]);
  return [...new Set([...owners.map((o) => o.email), ...(property?.email ? [property.email] : [])])];
}

/**
 * Record a dispute event from Stripe. Creating one also assembles the
 * evidence and emails the owner (once). Safe to call for repeats.
 */
export async function recordDispute(dispute: Stripe.Dispute): Promise<void> {
  const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id;
  const intentId = typeof dispute.payment_intent === 'string' ? dispute.payment_intent : dispute.payment_intent?.id;
  const payment = await prisma.payment.findFirst({
    where: { OR: [...(chargeId ? [{ stripeChargeId: chargeId }] : []), ...(intentId ? [{ stripePaymentIntentId: intentId }] : [])] },
    select: { bookingId: true, propertyId: true },
  });
  if (!payment) {
    console.error(`[payments] Dispute ${dispute.id} is for a charge we have no payment for (${chargeId ?? intentId ?? 'unknown'})`);
    return;
  }
  const closed = dispute.status === 'won' || dispute.status === 'lost';
  const data = {
    stripeChargeId: chargeId ?? null,
    bookingId: payment.bookingId,
    propertyId: payment.propertyId,
    amount: fromCents(dispute.amount),
    currency: dispute.currency,
    reason: dispute.reason ?? null,
    status: dispute.status,
    evidenceDueBy: dispute.evidence_details?.due_by ? new Date(dispute.evidence_details.due_by * 1000) : null,
    ...(closed ? { closedAt: new Date() } : {}),
  };
  const before = await prisma.dispute.findUnique({ where: { stripeDisputeId: dispute.id }, select: { id: true } });
  const record = await prisma.dispute.upsert({ where: { stripeDisputeId: dispute.id }, create: { stripeDisputeId: dispute.id, ...data }, update: data });

  if (!before) {
    // Hold the booking's payment status while the dispute is open (every room type of a reservation shares the payment).
    const booking = await prisma.booking.findUnique({ where: { id: payment.bookingId }, select: { id: true, groupCode: true } });
    for (const line of booking ? await paymentLines(booking) : []) {
      await prisma.booking.update({
        where: { id: line.id },
        data: {
          paymentStatus: 'DISPUTED',
          statusHistory: { create: { status: line.status, notes: `Card dispute opened (${dispute.reason ?? 'no reason given'}), ${fromCents(dispute.amount).toFixed(2)} ${dispute.currency.toUpperCase()}` } },
        },
      });
    }
  }
  if (OPEN_STATUSES.includes(dispute.status) && !record.evidenceSubmittedAt) await refreshEvidence(record.id);
  if (closed) await restorePaymentStatus(payment.bookingId, dispute.status === 'lost');
  if (!record.ownerNotifiedAt && !closed) await notifyOwner(record.id);
}

async function notifyOwner(disputeId: string): Promise<void> {
  const d = await prisma.dispute.findUnique({
    where: { id: disputeId },
    include: { property: { select: { id: true, name: true } }, booking: { select: { code: true, user: { select: { firstName: true, lastName: true } } } } },
  });
  if (!d || d.ownerNotifiedAt) return;
  const to = await ownerEmails(d.propertyId);
  if (!to.length) {
    console.warn(`[payments] Dispute ${d.stripeDisputeId}: no owner email to notify for property ${d.propertyId}`);
    return;
  }
  const base = publicSiteUrl() ?? '';
  const sent = await sendDisputeAlert({
    to,
    propertyName: d.property.name,
    guestName: d.booking ? `${d.booking.user.firstName} ${d.booking.user.lastName}`.trim() : null,
    bookingCode: d.booking?.code ?? null,
    amount: `${Number(d.amount).toFixed(2)} ${d.currency.toUpperCase()}`,
    reason: d.reason,
    dueBy: d.evidenceDueBy ? d.evidenceDueBy.toUTCString().replace(/ \d\d:\d\d:\d\d GMT$/, '') : null,
    consoleUrl: `${base}/admin/disputes?dispute=${d.id}`,
  });
  if (sent) await prisma.dispute.update({ where: { id: d.id }, data: { ownerNotifiedAt: new Date() } });
}

// ---------------------------------------------------------------------------
// Admin API (always scoped to the signed-in user's properties)
// ---------------------------------------------------------------------------

export interface DisputeDTO {
  id: string;
  stripeDisputeId: string;
  status: string;
  reason: string | null;
  amount: number;
  currency: string;
  evidenceDueBy: string | null;
  evidenceSubmittedAt: string | null;
  canSubmit: boolean;
  createdAt: string;
  property: { id: string; name: string };
  booking: { id: string; code: string | null; guestName: string } | null;
}

function toDTO(d: Prisma.DisputeGetPayload<{ include: { property: { select: { id: true; name: true } }; booking: { select: { id: true; code: true; user: { select: { firstName: true; lastName: true } } } } } }>): DisputeDTO {
  return {
    id: d.id,
    stripeDisputeId: d.stripeDisputeId,
    status: d.status,
    reason: d.reason,
    amount: Number(d.amount),
    currency: d.currency,
    evidenceDueBy: d.evidenceDueBy?.toISOString() ?? null,
    evidenceSubmittedAt: d.evidenceSubmittedAt?.toISOString() ?? null,
    canSubmit: OPEN_STATUSES.includes(d.status) && !d.evidenceSubmittedAt && !!d.bookingId,
    createdAt: d.createdAt.toISOString(),
    property: d.property,
    booking: d.booking ? { id: d.booking.id, code: d.booking.code, guestName: `${d.booking.user.firstName} ${d.booking.user.lastName}`.trim() } : null,
  };
}

const DTO_INCLUDE = {
  property: { select: { id: true, name: true } },
  booking: { select: { id: true, code: true, user: { select: { firstName: true, lastName: true } } } },
} as const;

export async function listDisputes(propertyId?: string | null): Promise<DisputeDTO[]> {
  const actor = await requireStaff('disputes.view');
  if (propertyId) assertPropertyAccess(actor, propertyId);
  const rows = await prisma.dispute.findMany({
    where: propertyId ? { propertyId } : scopeByProperty(actor),
    include: DTO_INCLUDE,
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return rows.map(toDTO);
}

async function loadScoped(disputeId: string) {
  const actor = await requireStaff('disputes.view');
  const d = await prisma.dispute.findUnique({ where: { id: disputeId }, include: DTO_INCLUDE });
  if (!d) throw notFound('Dispute');
  assertPropertyAccess(actor, d.propertyId);
  return { actor, d };
}

/** One dispute with its evidence summary (rebuilt from current records while it can still be answered). */
export async function getDispute(disputeId: string): Promise<{ dispute: DisputeDTO; evidence: EvidenceSummary | null; evidenceText: string | null }> {
  const { d } = await loadScoped(disputeId);
  let summary = (d.evidenceSummary as unknown as EvidenceSummary | null) ?? null;
  if (!d.evidenceSubmittedAt && OPEN_STATUSES.includes(d.status)) summary = (await refreshEvidence(d.id))?.summary ?? summary;
  return { dispute: toDTO(d), evidence: summary, evidenceText: summary ? renderEvidenceText(summary) : null };
}

/** Send the evidence to Stripe. Only ever called from an explicit click by someone allowed to manage disputes. */
export async function submitDisputeEvidence(disputeId: string): Promise<DisputeDTO> {
  const actor = await requireStaff('disputes.manage');
  const d = await prisma.dispute.findUnique({ where: { id: disputeId }, include: { ...DTO_INCLUDE, property: { select: { id: true, name: true, stripeAccountId: true } } } });
  if (!d) throw notFound('Dispute');
  assertPropertyAccess(actor, d.propertyId);
  if (d.evidenceSubmittedAt) throw badRequest('Evidence for this dispute has already been submitted.');
  if (!OPEN_STATUSES.includes(d.status)) throw badRequest('This dispute is no longer waiting for a response.');
  const built = await refreshEvidence(d.id);
  if (!built) throw badRequest('This dispute has no booking to build evidence from. Submit it from your Stripe dashboard.');
  const fields = stripeEvidenceFields(built.input, built.summary);
  const updated = await getStripe().disputes.update(
    d.stripeDisputeId,
    { evidence: fields, submit: true, metadata: { submittedBy: 'hotelone' } },
    d.property.stripeAccountId ? { stripeAccount: d.property.stripeAccountId } : undefined
  );
  const row = await prisma.dispute.update({
    where: { id: d.id },
    data: { evidenceSubmittedAt: new Date(), evidenceSubmittedById: actor.userId, status: updated.status },
    include: DTO_INCLUDE,
  });
  await recordAudit({ actor, source: 'classic' }, d.propertyId, 'DISPUTE_EVIDENCE_SUBMITTED', `Submitted dispute evidence for ${d.booking?.code ?? d.stripeDisputeId}`, { bookingId: d.bookingId, disputeId: d.id });
  return toDTO(row);
}
