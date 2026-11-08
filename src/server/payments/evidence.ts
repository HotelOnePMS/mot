/**
 * Dispute evidence: turns our own records about a booking into (1) a readable
 * summary the hotel reviews and downloads (as text, or a page to print or save
 * as a PDF) and (2) the text fields Stripe's disputes API accepts. It opens
 * with a summary for the bank that answers the cardholder's reason, built only
 * from what the records show, and lists for the hotel what's missing.
 * Pure functions (no imports) so they are unit-tested.
 *
 * Nothing here is sent anywhere: submission is a separate, explicit action.
 */

export interface EvidenceInput {
  generatedAt: string;
  hotel: { name: string; address: string; phone: string; email: string | null };
  guest: { name: string; email: string; phone: string | null };
  booking: {
    code: string;
    status: string;
    checkIn: string;
    checkOut: string;
    nights: number;
    rooms: number;
    guests: number;
    roomType: string;
    totalPrice: number;
    /** Allowances the hotel gave (lowering what the stay cost), e.g. "25.00 off: air conditioning broken". */
    allowances?: string[];
    createdAt: string;
    notes: string | null;
  };
  payments: {
    amount: number;
    currency: string;
    status: string;
    paidAt: string | null;
    cardholderName: string | null;
    billingEmail: string | null;
    billingCountry: string | null;
    cardCountry: string | null;
    cardBrand: string | null;
    cardLast4: string | null;
    threeDSecure: string | null;
    riskLevel: string | null;
  }[];
  policy: { version: string; hash: string; text: string; acceptedAt: string; ip: string | null; userAgent: string | null } | null;
  /** When and where the guest was checked in, from the booking history. */
  stay: { checkedInAt: string | null; roomNumber: string | null; checkedOutAt: string | null };
  checklist: { item: string; at: string | null; by: string | null }[];
  /** Signed cardholder authorizations (someone else paid for the stay). */
  authorizations?: AuthorizationEvidence[];
  /** What the guided check-in recorded: the photo ID checked, the registration card signed, deposits taken. */
  checkIn?: CheckInEvidence | null;
  riskFlags: string[];
  history: { status: string; notes: string | null; at: string }[];
  /** The itemized folio: charges, allowances, payments and refunds, with the totals. */
  folio?: EvidenceFolio | null;
  /** stripeId is null for a chargeback the hotel heard about another way (a bank letter, its card terminal's processor). */
  dispute: { stripeId: string | null; reason: string | null; amount: number; currency: string };
}

export interface EvidenceFolio {
  currency: string;
  /** Signed as on the folio: charges positive, allowances and payments negative, refunds positive. */
  lines: { section: 'CHARGES' | 'PAYMENTS'; label: string; detail: string | null; amount: number; at: string | null }[];
  totals: { charges: number; allowances: number; paid: number; refunded: number; balance: number };
}

export interface AuthorizationEvidence {
  signedAt: string;
  signerName: string;
  email: string | null;
  phone: string | null;
  billingAddress: string | null;
  card: string;
  /** The digits were checked against the card that paid online. */
  cardMatchesPayment: boolean;
  idDocument: string;
  idPhotoKept: boolean;
  signatureMethod: string | null;
  guestNames: string[];
  checks: { label: string; result: string }[];
  ip: string | null;
  userAgent: string | null;
  review: string;
  textVersion: string | null;
  textHash: string | null;
  documentHash: string | null;
  text: string | null;
}

export interface CheckInEvidence {
  /** One per room type checked in with the guided check-in (a reservation of several room types can have several). */
  records: CheckInRecordEvidence[];
  deposits: string[];
}

export interface CheckInRecordEvidence {
  /** The room type, when the reservation has several. */
  roomType: string | null;
  /** e.g. "Driver’s license issued in United States, number ending 7781, name on ID Jane Sample (matches the booking)". */
  id: string | null;
  idCheckedAt: string | null;
  idCheckedBy: string | null;
  idPhotoKept: boolean;
  registration: {
    signedAt: string;
    signatureMethod: string;
    ip: string | null;
    witnessedBy: string | null;
    textVersion: string;
    textHash: string;
    documentHash: string;
    text: string;
  } | null;
}

export interface EvidenceSection {
  title: string;
  lines: string[];
}

export interface EvidenceSummary {
  generatedAt: string;
  sections: EvidenceSection[];
}

const money = (n: number, currency: string) => `${n.toFixed(2)} ${currency.toUpperCase()}`;
const when = (iso: string | null | undefined) => (iso ? iso.replace('T', ' ').replace(/:\d{2}\.\d+Z$/, ' UTC').replace(/Z$/, ' UTC') : 'not recorded');
const or = (v: string | null | undefined, empty = 'not recorded') => (v && v.trim() ? v : empty);

const THREE_DS_TEXT: Record<string, string> = {
  authenticated: 'Completed: the cardholder’s bank verified the payment',
  attempt_acknowledged: 'Attempted: the bank acknowledged the verification attempt',
  exempted: 'Exempted by the bank',
  not_supported: 'Not supported by this card',
  failed: 'Failed',
  processing_error: 'Processing error',
  not_attempted: 'Not attempted',
};

/** The reasons card networks give, as Stripe names them, in words. */
export const DISPUTE_REASON_LABEL: Record<string, string> = {
  fraudulent: 'Fraudulent: the cardholder says they didn’t authorize the payment',
  unrecognized: 'Unrecognized: the cardholder doesn’t recognize the charge',
  product_not_received: 'Not received: the cardholder says the stay or service wasn’t provided',
  product_unacceptable: 'Not as described: the cardholder says the stay was unacceptable',
  credit_not_processed: 'Credit not processed: the cardholder says a cancellation or refund wasn’t honored',
  duplicate: 'Duplicate: the cardholder says they were charged twice',
  subscription_canceled: 'Canceled: the cardholder says they canceled',
  debit_not_authorized: 'Debit not authorized: the cardholder says they didn’t authorize the payment',
  customer_initiated: 'Customer initiated',
  general: 'General',
};

export const disputeReasonLabel = (reason: string | null | undefined): string =>
  reason ? (DISPUTE_REASON_LABEL[reason] ?? reason.replace(/_/g, ' ')) : 'not given';

const FRAUD_REASONS = ['fraudulent', 'unrecognized', 'debit_not_authorized'];

const words = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

/** "PAT JONES" and "Pat Jones", or "Jamie Lee Smith" and "Jamie Smith": the same first and last name. */
function sameName(a: string, b: string): boolean {
  const x = words(a);
  const y = words(b);
  return !!x.length && !!y.length && x[0] === y[0] && x[x.length - 1] === y[y.length - 1];
}

const lastAt = (history: EvidenceInput['history'], status: string) => [...history].reverse().find((h) => h.status === status)?.at ?? null;
const daysBetween = (fromIso: string, toDay: string) => Math.round((Date.parse(`${toDay.slice(0, 10)}T00:00:00Z`) - Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`)) / 86_400_000);

/** What the records show, for the summary and the gaps. */
function factsOf(i: EvidenceInput) {
  const records = i.checkIn?.records ?? [];
  const checked = (item: string) => i.checklist.some((c) => c.item === item && !!c.at);
  return {
    stayed: !!i.stay.checkedInAt,
    authenticated: i.payments.filter((p) => p.threeDSecure === 'authenticated'),
    idChecked: records.some((r) => !!r.id) || checked('ID matches guest'),
    registrationSigned: records.some((r) => !!r.registration) || checked('Registration signed'),
    authorization: i.authorizations?.[0] ?? null,
    cardholders: [...new Set(i.payments.map((p) => p.cardholderName?.trim()).filter((n): n is string => !!n))],
    cancelledAt: lastAt(i.history, 'CANCELLED'),
    noShowAt: lastAt(i.history, 'NO_SHOW'),
  };
}

/**
 * The case for the charge, in a few sentences of fact a bank reviewer can check against the records that follow:
 * which facts lead depends on what the cardholder claims. Only what the records show is stated.
 */
export function summaryForBank(i: EvidenceInput): string[] {
  const f = factsOf(i);
  const nights = `${i.booking.nights} ${i.booking.nights === 1 ? 'night' : 'nights'}`;
  const c = i.folio?.currency ?? i.dispute.currency;
  const booked = `${i.guest.name} booked ${i.booking.roomType} at ${i.hotel.name} for ${i.booking.checkIn} to ${i.booking.checkOut} (${nights}) on ${when(i.booking.createdAt)}, confirmation code ${i.booking.code}.`;
  const stay = f.stayed
    ? `The guest checked in on ${when(i.stay.checkedInAt)}${i.stay.roomNumber ? ` and stayed in room ${i.stay.roomNumber}` : ''}${i.stay.checkedOutAt ? `, checking out on ${when(i.stay.checkedOutAt)}` : ''}.`
    : null;
  const id = f.idChecked ? 'The front desk checked the guest’s photo ID at check-in (details below).' : null;
  const registration = f.registrationSigned ? 'The guest signed the registration card at the front desk.' : null;
  const tds = f.authenticated.length
    ? `The card payment${f.authenticated.length > 1 ? 's were' : ' was'} authenticated with 3D Secure by the cardholder’s bank.`
    : null;
  const a = f.authorization;
  const authorized = a ? `The cardholder, ${a.signerName}, signed an authorization for this stay on ${when(a.signedAt)}, giving ${a.idDocument}.` : null;
  const holder = f.cardholders.some((n) => sameName(n, i.guest.name)) ? 'The cardholder’s name on the payment is the guest’s name.' : null;
  const policy = i.policy
    ? `When booking, the guest accepted the hotel’s cancellation and refund policy on ${when(i.policy.acceptedAt)}${i.policy.ip ? ` from IP ${i.policy.ip}` : ''}; its text is below.`
    : null;
  const t = i.folio?.totals;
  const charged = t
    ? `The folio’s charges come to ${money(t.charges - t.allowances, c)}${t.allowances ? ` after ${money(t.allowances, c)} of allowances` : ''}; ${money(t.paid, c)} was paid${t.refunded ? ` and ${money(t.refunded, c)} refunded` : ''}.`
    : null;
  const allowances = i.booking.allowances?.length ? `The hotel already lowered the bill: ${i.booking.allowances.join('; ')}.` : null;
  const cancelled = f.cancelledAt
    ? (() => {
        const before = daysBetween(f.cancelledAt, i.booking.checkIn);
        return `The reservation was cancelled on ${when(f.cancelledAt)}${before > 0 ? `, ${before} ${before === 1 ? 'day' : 'days'} before arrival` : before === 0 ? ', on the day of arrival' : ''}.`;
      })()
    : null;
  const noShow = f.noShowAt ? `The guest didn’t arrive: the reservation was marked a no-show on ${when(f.noShowAt)}.` : null;
  const payments = i.payments.length
    ? `${i.payments.length === 1 ? 'One payment was' : `${i.payments.length} separate payments were`} taken for this reservation: ${i.payments
        .map((p) => `${money(p.amount, p.currency)}${p.paidAt ? ` on ${when(p.paidAt)}` : ''}${p.cardLast4 ? ` (card ending ${p.cardLast4})` : ''}`)
        .join('; ')}.`
    : null;

  const reason = i.dispute.reason ?? 'general';
  const facts = FRAUD_REASONS.includes(reason)
    ? [tds, authorized, holder, id, registration, stay, policy]
    : reason === 'product_not_received'
      ? [stay ?? noShow ?? cancelled, registration, id, policy, charged]
      : reason === 'credit_not_processed' || reason === 'subscription_canceled'
        ? [policy, cancelled, noShow, stay, allowances, charged]
        : reason === 'product_unacceptable'
          ? [stay, registration, allowances, policy, charged]
          : reason === 'duplicate'
            ? [payments, charged]
            : [stay, id, registration, tds, authorized, policy, charged];
  return [booked, ...facts.filter((x): x is string => !!x)];
}

/**
 * For the hotel, not the bank: what's missing or weak in the records for this reason, so they can add it or know
 * where they stand before answering.
 */
export function evidenceGaps(i: EvidenceInput): string[] {
  const f = factsOf(i);
  const reason = i.dispute.reason ?? 'general';
  const gaps: string[] = [];
  if (!i.payments.length) gaps.push('No card payment is recorded for this reservation: check which payment the chargeback is for, and add its receipt.');
  if (FRAUD_REASONS.includes(reason)) {
    if (!f.authenticated.length && !f.authorization && !f.idChecked) {
      gaps.push('Nothing ties the cardholder to the stay: no 3D Secure, no signed cardholder authorization and no photo ID check. Fraud claims are hard to win without one of them.');
    } else if (!f.authorization && f.cardholders.length && !f.cardholders.some((n) => sameName(n, i.guest.name))) {
      gaps.push(`The cardholder (${f.cardholders.join(', ')}) isn’t the guest, and there’s no signed cardholder authorization.`);
    }
  }
  if (!i.policy) gaps.push('There’s no record of the guest accepting the cancellation policy when booking.');
  const ended = i.booking.checkOut <= i.generatedAt.slice(0, 10);
  if (!f.stayed && !f.noShowAt && !f.cancelledAt && ended && i.booking.status !== 'CANCELLED' && i.booking.status !== 'NO_SHOW') {
    gaps.push('No check-in is recorded, though the stay has ended.');
  }
  if (f.stayed && !f.idChecked) gaps.push('No photo ID check is recorded at check-in.');
  if (f.stayed && !f.registrationSigned) gaps.push('No signed registration card is on file.');
  return gaps;
}

export function buildEvidenceSummary(i: EvidenceInput): EvidenceSummary {
  const sections: EvidenceSection[] = [];

  sections.push({
    title: 'Dispute',
    lines: [
      i.dispute.stripeId ? `Stripe dispute: ${i.dispute.stripeId}` : 'Chargeback reported to the hotel (not received through Stripe)',
      `Reason given: ${disputeReasonLabel(i.dispute.reason)}`,
      `Amount disputed: ${money(i.dispute.amount, i.dispute.currency)}`,
    ],
  });

  sections.push({ title: 'Summary', lines: summaryForBank(i) });

  sections.push({
    title: 'Booking',
    lines: [
      `Hotel: ${i.hotel.name}, ${i.hotel.address}${i.hotel.phone ? `, ${i.hotel.phone}` : ''}`,
      `Confirmation code: ${i.booking.code}`,
      `Booked on: ${when(i.booking.createdAt)}`,
      `Stay: ${i.booking.checkIn} to ${i.booking.checkOut} (${i.booking.nights} ${i.booking.nights === 1 ? 'night' : 'nights'}), ${i.booking.rooms} ${i.booking.rooms === 1 ? 'room' : 'rooms'}, ${i.booking.guests} ${i.booking.guests === 1 ? 'guest' : 'guests'}`,
      `Room type: ${i.booking.roomType}`,
      `Booking total: ${i.booking.totalPrice.toFixed(2)}`,
      ...(i.booking.allowances ?? []).map((a) => `Allowance given by the hotel: ${a}`),
      `Booking status: ${i.booking.status}`,
      ...(i.booking.notes ? [`Notes on the booking: ${i.booking.notes.replace(/\s*\n\s*/g, ' | ')}`] : []),
    ],
  });

  sections.push({
    title: 'Guest (booking name, kept separate from the cardholder)',
    lines: [`Name: ${i.guest.name}`, `Email: ${i.guest.email}`, `Phone: ${or(i.guest.phone)}`],
  });

  sections.push({
    title: 'Payment',
    lines: i.payments.length
      ? i.payments.flatMap((p, n) => [
          `Payment ${n + 1}: ${money(p.amount, p.currency)}, ${p.status.toLowerCase()}${p.paidAt ? `, paid ${when(p.paidAt)}` : ''}`,
          `  Cardholder name: ${or(p.cardholderName)}`,
          `  Billing email: ${or(p.billingEmail)}`,
          `  Billing country: ${or(p.billingCountry)}; card issued in: ${or(p.cardCountry)}`,
          `  Card: ${[p.cardBrand, p.cardLast4 ? `ending ${p.cardLast4}` : null].filter(Boolean).join(' ') || 'not recorded'}`,
          `  3D Secure: ${THREE_DS_TEXT[p.threeDSecure ?? 'not_attempted'] ?? p.threeDSecure}`,
          `  Stripe fraud screening: ${or(p.riskLevel)}`,
        ])
      : ['No online payment is recorded for this booking.'],
  });

  if (i.folio) {
    const c = i.folio.currency;
    const t = i.folio.totals;
    const item = (l: EvidenceFolio['lines'][number], amount: string) => `${l.label}${l.detail ? ` (${l.detail})` : ''}${l.at ? `, ${when(l.at)}` : ''}: ${amount}`;
    sections.push({
      title: 'Folio (itemized)',
      lines: [
        ...i.folio.lines.filter((l) => l.section === 'CHARGES').map((l) => item(l, l.amount < 0 ? `-${money(-l.amount, c)}` : money(l.amount, c))),
        ...i.folio.lines.filter((l) => l.section === 'PAYMENTS').map((l) => item(l, money(Math.abs(l.amount), c))),
        `Charges ${money(t.charges, c)}${t.allowances ? `, allowances -${money(t.allowances, c)}` : ''}, paid ${money(t.paid, c)}${t.refunded ? `, refunded ${money(t.refunded, c)}` : ''}, balance ${money(t.balance, c)}`,
      ],
    });
  }

  if (i.authorizations?.length) {
    sections.push({
      title: 'Cardholder authorization',
      lines: i.authorizations.flatMap((a, n) => [
        ...(i.authorizations!.length > 1 ? [`Authorization ${n + 1}:`] : []),
        `Signed by the cardholder ${a.signerName} on ${when(a.signedAt)} from IP ${or(a.ip)}`,
        `Device: ${or(a.userAgent)}`,
        `Cardholder contact: ${or(a.email)}; phone ${or(a.phone)}`,
        `Billing address given: ${or(a.billingAddress)}`,
        `Card: ${a.card}${a.cardMatchesPayment ? ' (the last four digits entered match the card that paid)' : ''}`,
        `Photo ID: ${a.idDocument}${a.idPhotoKept ? '; a photo of the ID is kept by the hotel' : ''}`,
        `Signature: ${a.signatureMethod === 'DRAWN' ? 'drawn by hand on screen' : a.signatureMethod === 'TYPED' ? 'typed full name adopted as signature' : 'not recorded'}`,
        `Guests the cardholder authorized: ${a.guestNames.join(', ')}`,
        ...(a.checks.length ? [`Details compared: ${a.checks.map((c) => `${c.label}: ${c.result.toLowerCase()}`).join('; ')}`] : []),
        `Hotel review: ${a.review}`,
        `Record SHA-256: ${or(a.documentHash)} (wording version ${or(a.textVersion)}, SHA-256 ${or(a.textHash)})`,
        'Wording the cardholder agreed to:',
        or(a.text),
      ]),
    });
  }

  sections.push({
    title: 'Cancellation and refund policy accepted',
    lines: i.policy
      ? [
          `Accepted: ${when(i.policy.acceptedAt)} from IP ${or(i.policy.ip)}`,
          `Device: ${or(i.policy.userAgent)}`,
          `Policy version ${i.policy.version} (SHA-256 ${i.policy.hash})`,
          'Text shown to the guest:',
          i.policy.text,
        ]
      : ['No policy acceptance is recorded for this booking.'],
  });

  sections.push({
    title: 'Stay and check-in',
    lines: [
      `Checked in: ${when(i.stay.checkedInAt)}${i.stay.roomNumber ? `, room ${i.stay.roomNumber}` : ''}`,
      `Checked out: ${when(i.stay.checkedOutAt)}`,
      ...(i.riskFlags.length ? [`Risk flags at booking: ${i.riskFlags.join(', ')}`] : ['No risk flags were raised.']),
      ...(i.checklist.length
        ? i.checklist.map((c) => `Front desk check: ${c.item}: ${c.at ? `done ${when(c.at)} by ${or(c.by, 'staff')}` : 'not done'}`)
        : []),
    ],
  });

  if (i.checkIn && (i.checkIn.records.length || i.checkIn.deposits.length)) {
    const c = i.checkIn;
    const records = c.records.length ? c.records : [{ roomType: null, id: null, idCheckedAt: null, idCheckedBy: null, idPhotoKept: false, registration: null }];
    sections.push({
      title: 'Check-in: photo ID and registration card',
      lines: [
        ...records.flatMap((r) => {
          const on = r.roomType ? ` (${r.roomType})` : '';
          return [
            ...(r.id ? [`Photo ID checked at the desk${on}: ${r.id}${r.idCheckedAt ? `, on ${when(r.idCheckedAt)}` : ''}${r.idCheckedBy ? ` by ${r.idCheckedBy}` : ''}${r.idPhotoKept ? '; a photo of the ID is kept by the hotel' : ''}`] : [`No photo ID was recorded at check-in${on}.`]),
            ...(r.registration
              ? [
                  `Registration card${on} signed by the guest on ${when(r.registration.signedAt)} (${r.registration.signatureMethod === 'DRAWN' ? 'signature drawn on screen' : 'typed name adopted as signature'}) at the front desk${r.registration.witnessedBy ? `, with ${r.registration.witnessedBy}` : ''}, from IP ${or(r.registration.ip)}`,
                  `Record SHA-256: ${r.registration.documentHash} (wording version ${r.registration.textVersion}, SHA-256 ${r.registration.textHash})`,
                  'Registration card as signed:',
                  r.registration.text,
                ]
              : [`No registration card was signed${on}.`]),
          ];
        }),
        ...c.deposits.map((d) => `Security deposit: ${d}`),
      ],
    });
  }

  sections.push({
    title: 'Booking history',
    lines: i.history.length ? i.history.map((h) => `${when(h.at)}, ${h.status}${h.notes ? `: ${h.notes}` : ''}`) : ['No history recorded.'],
  });

  return { generatedAt: i.generatedAt, sections };
}

/** The summary as plain text, for review and download. */
export function renderEvidenceText(summary: EvidenceSummary): string {
  return [
    `Dispute evidence (generated ${when(summary.generatedAt)})`,
    '',
    ...summary.sections.flatMap((s) => [s.title.toUpperCase(), ...s.lines, '']),
  ]
    .join('\n')
    .trim();
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

/**
 * The summary as a page to read, print or save as a PDF (the browser's Print → Save as PDF). Everything in it is
 * escaped: booking notes and names are typed by guests and staff.
 */
export function renderEvidenceHtml(summary: EvidenceSummary, title: string): string {
  const sections = summary.sections
    .map((s) => `<section><h2>${escapeHtml(s.title)}</h2>${s.lines.map((l) => `<p>${escapeHtml(l)}</p>`).join('')}</section>`)
    .join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title>
<style>
body{margin:0;background:#fff;color:#111;font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
main{max-width:760px;margin:0 auto;padding:32px 20px 48px}
h1{font-size:22px;margin:0 0 4px}
.meta{color:#555;margin:0 0 24px}
.hint{background:#f4f4f5;border-radius:8px;padding:10px 12px;color:#333;margin:0 0 24px}
h2{font-size:13px;letter-spacing:.06em;text-transform:uppercase;border-bottom:1px solid #ddd;padding-bottom:4px;margin:28px 0 8px}
p{margin:0 0 4px;white-space:pre-wrap;overflow-wrap:anywhere}
@media print{.hint{display:none}main{padding:0}h2{break-after:avoid}}
</style></head>
<body><main><p class="hint">To keep this as a PDF, use your browser’s Print and choose Save as PDF.</p><h1>${escapeHtml(title)}</h1><p class="meta">Generated ${escapeHtml(when(summary.generatedAt))}</p>${sections}</main></body></html>`;
}

const FIELD_LIMIT = 19_000;
const clip = (s: string) => (s.length > FIELD_LIMIT ? `${s.slice(0, FIELD_LIMIT - 1)}…` : s);

/**
 * The fields of `evidence` for Stripe's disputes API (text fields only; Stripe
 * file uploads are not used). Fields with nothing to say are omitted.
 */
export function stripeEvidenceFields(i: EvidenceInput, summary: EvidenceSummary): Record<string, string> {
  const section = (title: string) => summary.sections.find((s) => s.title.startsWith(title))?.lines.join('\n') ?? '';
  const fields: Record<string, string> = {
    product_description: `Hotel stay: ${i.booking.roomType} at ${i.hotel.name}, ${i.booking.checkIn} to ${i.booking.checkOut} (${i.booking.nights} ${i.booking.nights === 1 ? 'night' : 'nights'}, ${i.booking.rooms} ${i.booking.rooms === 1 ? 'room' : 'rooms'}, ${i.booking.guests} ${i.booking.guests === 1 ? 'guest' : 'guests'}). Confirmation code ${i.booking.code}.`,
    customer_name: i.guest.name,
    customer_email_address: i.guest.email,
    service_date: `${i.booking.checkIn} to ${i.booking.checkOut}`,
    access_activity_log: section('Stay and check-in') + (i.history.length ? `\n\n${section('Booking history')}` : ''),
    uncategorized_text: renderEvidenceText(summary),
  };
  if (i.policy) {
    const disclosure = `${i.policy.text}\n\nAccepted by the guest at booking on ${when(i.policy.acceptedAt)} from IP ${or(i.policy.ip)} (policy version ${i.policy.version}, SHA-256 ${i.policy.hash}).`;
    fields.cancellation_policy_disclosure = disclosure;
    fields.refund_policy_disclosure = disclosure;
    if (i.policy.ip) fields.customer_purchase_ip = i.policy.ip;
  }
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v.trim()).map(([k, v]) => [k, clip(v)]));
}
