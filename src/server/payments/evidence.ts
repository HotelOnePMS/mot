/**
 * Dispute evidence: turns our own records about a booking into (1) a readable
 * summary the hotel reviews and downloads and (2) the text fields Stripe's
 * disputes API accepts. Pure functions (no imports) so they are unit-tested.
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
  dispute: { stripeId: string; reason: string | null; amount: number; currency: string };
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

export function buildEvidenceSummary(i: EvidenceInput): EvidenceSummary {
  const sections: EvidenceSection[] = [];

  sections.push({
    title: 'Dispute',
    lines: [
      `Stripe dispute: ${i.dispute.stripeId}`,
      `Reason given: ${or(i.dispute.reason)}`,
      `Amount disputed: ${money(i.dispute.amount, i.dispute.currency)}`,
    ],
  });

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
    `Dispute evidence (generated ${when(summary.generatedAt)}`,
    '',
    ...summary.sections.flatMap((s) => [s.title.toUpperCase(), ...s.lines, '']),
  ]
    .join('\n')
    .trim();
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
