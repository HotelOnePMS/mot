/**
 * Transactional email (Resend): the guest's booking confirmation.
 *
 * Sent from HotelOne on the hotel's behalf. The default sender needs
 * hotelone.site verified in Resend (SPF/DKIM); EMAIL_FROM overrides it.
 * Without RESEND_API_KEY nothing is sent and bookings work as usual.
 */
import { Resend } from 'resend';
import { PRODUCT_DOMAIN, PRODUCT_NAME, PRODUCT_URL } from '@/config/product';
import { money } from '@/lib/status';
import { formatPhone } from '@/lib/format';

const resendApiKey = process.env.RESEND_API_KEY;
const fromAddress = process.env.EMAIL_FROM || `${PRODUCT_NAME} <bookings@${PRODUCT_DOMAIN}>`;

let resend: Resend | null = null;
if (resendApiKey) {
  resend = new Resend(resendApiKey);
} else {
  console.warn('RESEND_API_KEY is not set — booking confirmation emails are disabled.');
}

export function isEmailConfigured(): boolean {
  return resend !== null;
}

export interface BookingEmailData {
  to: string;
  guestName: string;
  propertyName: string;
  roomTypeName: string;
  /** Calendar day, YYYY-MM-DD. */
  checkIn: string;
  /** Calendar day, YYYY-MM-DD. */
  checkOut: string;
  guests: number;
  rooms: number;
  /** Amount in the hotel's currency, e.g. "240.00". */
  totalPrice: string;
  bookingId: string;
  /** PAID, DEPOSIT_PAID or PAY_AT_PROPERTY. */
  paymentStatus: string;
  /** Collected online so far, e.g. "120.00" (deposits). */
  amountPaid?: string;
}

// Email clients ignore CSS variables and dark-mode classes: the light theme's
// tokens as hex (globals.css), all WCAG AA on white.
const C = {
  primary: '#085f81', // --primary (Lagoon), hsl(197 88% 27%)
  ink: '#111827', // --foreground
  muted: '#575d6b', // --muted-foreground
  page: '#f6f4f1', // --surface-sunken
  card: '#ffffff',
  border: '#e5e2dc', // --border
  successSoft: '#e8f7f0',
  successInk: '#0e623c', // --success-soft-foreground
  neutralSoft: '#f6f4f1',
} as const;

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const escapeHtml = (v: unknown) =>
  String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

// Control characters (line breaks included), zero-width characters and bidirectional overrides.
const SUBJECT_UNSAFE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g;

/**
 * Owner-editable text (the hotel's name) as it may appear in a subject line:
 * control, zero-width and bidi-override characters and line breaks removed,
 * whitespace collapsed, at most `max` characters.
 */
function subjectText(v: string, max = 60): string {
  const s = String(v ?? '').replace(SUBJECT_UNSAFE, ' ').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

const dayFormat = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** "Fri, Oct 16, 2026" for a calendar day; anything unexpected is shown as given. */
function formatDay(day: string): string {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(day) ? new Date(`${day}T12:00:00Z`) : null;
  return d && !Number.isNaN(d.getTime()) ? dayFormat.format(d) : day;
}

function nightsBetween(checkIn: string, checkOut: string): number | null {
  const a = Date.parse(`${checkIn}T12:00:00Z`);
  const b = Date.parse(`${checkOut}T12:00:00Z`);
  const n = Math.round((b - a) / 86_400_000);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function formatTotal(total: string): string {
  const n = Number(total);
  return Number.isFinite(n) ? money(n) : total;
}

interface Detail {
  label: string;
  value: string;
}

function confirmationContent(data: BookingEmailData) {
  const paid = data.paymentStatus === 'PAID';
  const deposit = data.paymentStatus === 'DEPOSIT_PAID';
  const nights = nightsBetween(data.checkIn, data.checkOut);
  const details: Detail[] = [
    { label: 'Booking reference', value: data.bookingId },
    { label: 'Room', value: `${data.roomTypeName}${data.rooms > 1 ? ` × ${data.rooms}` : ''}` },
    { label: 'Check-in', value: formatDay(data.checkIn) },
    { label: 'Check-out', value: formatDay(data.checkOut) },
    ...(nights ? [{ label: 'Length of stay', value: plural(nights, 'night') }] : []),
    { label: 'Guests', value: plural(data.guests, 'guest') },
    { label: 'Total', value: formatTotal(data.totalPrice) },
  ];
  return {
    paid: paid || deposit,
    details,
    paymentLabel: paid ? 'Paid online' : deposit ? 'Deposit paid online' : 'Pay at the hotel',
    paymentNote: paid
      ? 'Your payment has been received.'
      : deposit
        ? `Your deposit${data.amountPaid ? ` of ${formatTotal(data.amountPaid)}` : ''} has been received. You’ll pay the balance at the hotel.`
        : 'Nothing has been charged — you’ll pay the hotel during your stay.',
    preheader: `${data.propertyName}: ${formatDay(data.checkIn)} to ${formatDay(data.checkOut)}. Reference ${data.bookingId}.`,
  };
}

function confirmationHtml(data: BookingEmailData): string {
  const c = confirmationContent(data);
  const e = (v: unknown) => escapeHtml(v);
  const rows = c.details
    .map(
      (d, i) => `
                <tr>
                  <td style="padding: 12px 0; ${i ? `border-top: 1px solid ${C.border};` : ''} color: ${C.muted}; font-size: 14px; line-height: 20px; width: 42%; vertical-align: top;">${e(d.label)}</td>
                  <td style="padding: 12px 0; ${i ? `border-top: 1px solid ${C.border};` : ''} color: ${C.ink}; font-size: 14px; line-height: 20px; font-weight: 600; text-align: right; vertical-align: top;">${e(d.value)}</td>
                </tr>`,
    )
    .join('');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
    <title>Your booking is confirmed</title>
  </head>
  <body style="margin: 0; padding: 0; background: ${C.page}; font-family: ${FONT}; color: ${C.ink};">
    <div style="display: none; max-height: 0; overflow: hidden; opacity: 0; color: transparent;">${e(c.preheader)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: ${C.page};">
      <tr>
        <td align="center" style="padding: 32px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 560px;">
            <tr>
              <td style="padding: 0 4px 16px; font-size: 15px; line-height: 22px; font-weight: 700; color: ${C.ink};">${e(data.propertyName)}</td>
            </tr>
            <tr>
              <td style="background: ${C.card}; border: 1px solid ${C.border}; border-radius: 16px; overflow: hidden;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr><td style="height: 6px; background: ${C.primary}; font-size: 0; line-height: 0;">&nbsp;</td></tr>
                  <tr>
                    <td style="padding: 28px 28px 8px;">
                      <h1 style="margin: 0 0 12px; font-size: 22px; line-height: 30px; font-weight: 700; color: ${C.ink};">Your booking is confirmed</h1>
                      <p style="margin: 0 0 8px; font-size: 15px; line-height: 24px; color: ${C.ink};">Hi ${e(data.guestName)},</p>
                      <p style="margin: 0; font-size: 15px; line-height: 24px; color: ${C.ink};">Thank you for booking with <strong>${e(data.propertyName)}</strong>. Here are the details of your stay — keep this email handy for check-in.</p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 16px 28px 4px;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 12px 28px 28px;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: ${c.paid ? C.successSoft : C.neutralSoft}; border-radius: 12px;">
                        <tr>
                          <td style="padding: 14px 16px; font-size: 14px; line-height: 20px; color: ${c.paid ? C.successInk : C.ink};">
                            <strong>${c.paid ? '&#10003; ' : ''}${e(c.paymentLabel)}</strong><br>
                            <span style="color: ${c.paid ? C.successInk : C.muted};">${e(c.paymentNote)}</span>
                          </td>
                        </tr>
                      </table>
                      <p style="margin: 20px 0 0; font-size: 15px; line-height: 24px; color: ${C.ink};">We look forward to hosting you!</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding: 20px 4px 0; font-size: 12px; line-height: 18px; color: ${C.muted};">
                Sent by <a href="${PRODUCT_URL}" style="color: ${C.primary}; text-decoration: underline;">${PRODUCT_NAME}</a> for ${e(data.propertyName)}. You’re receiving this because a stay was booked with this email address.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function confirmationText(data: BookingEmailData): string {
  const c = confirmationContent(data);
  return [
    'Your booking is confirmed',
    '',
    `Hi ${data.guestName},`,
    '',
    `Thank you for booking with ${data.propertyName}. Here are the details of your stay — keep this email handy for check-in.`,
    '',
    ...c.details.map((d) => `${d.label}: ${d.value}`),
    `Payment: ${c.paymentLabel}. ${c.paymentNote}`,
    '',
    'We look forward to hosting you!',
    '',
    '—',
    `Sent by ${PRODUCT_NAME} (${PRODUCT_URL}) for ${data.propertyName}.`,
  ].join('\n');
}

/** Send a booking confirmation email. Silently skips (logs) when Resend is not configured. */
export async function sendBookingConfirmation(data: BookingEmailData): Promise<void> {
  if (!resend) {
    console.log(`[email] Skipping confirmation email to ${data.to} (RESEND_API_KEY not configured)`);
    return;
  }
  try {
    await resend.emails.send({
      from: fromAddress,
      to: data.to,
      subject: `Booking confirmed — ${subjectText(data.propertyName) || 'your stay'}`,
      html: confirmationHtml(data),
      text: confirmationText(data),
    });
  } catch (error) {
    console.error('[email] Failed to send booking confirmation:', error);
  }
}

export interface GuestRequestAlertData {
  to: string[];
  propertyName: string;
  /** "Phone call", "WhatsApp", "Booking page"… */
  channel: string;
  /** A booking request rather than a message. */
  booking: boolean;
  guestName: string;
  phone: string | null;
  email: string | null;
  message: string;
  /** Where the team handles it in the console. */
  consoleUrl: string;
}

function alertHtml(data: GuestRequestAlertData): string {
  const e = (v: unknown) => escapeHtml(v);
  const title = data.booking ? `New booking request from ${data.guestName}` : `New message from ${data.guestName}`;
  const contacts = [
    data.phone ? `<a href="tel:${e(data.phone.replace(/[^\d+]/g, ''))}" style="color: ${C.primary}; font-weight: 600; text-decoration: none;">${e(formatPhone(data.phone))}</a>` : '',
    data.email ? `<a href="mailto:${e(data.email)}" style="color: ${C.primary}; font-weight: 600; text-decoration: none;">${e(data.email)}</a>` : '',
  ]
    .filter(Boolean)
    .join(' &nbsp;·&nbsp; ');
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <title>${e(title)}</title>
  </head>
  <body style="margin: 0; padding: 0; background: ${C.page}; font-family: ${FONT}; color: ${C.ink};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: ${C.page};">
      <tr>
        <td align="center" style="padding: 32px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 560px;">
            <tr>
              <td style="padding: 0 4px 16px; font-size: 15px; line-height: 22px; font-weight: 700; color: ${C.ink};">${e(data.propertyName)}</td>
            </tr>
            <tr>
              <td style="background: ${C.card}; border: 1px solid ${C.border}; border-radius: 16px; padding: 28px;">
                <p style="margin: 0 0 6px; font-size: 13px; line-height: 18px; color: ${C.muted};">${e(data.channel)} · your voice front desk</p>
                <h1 style="margin: 0 0 16px; font-size: 20px; line-height: 28px; font-weight: 700; color: ${C.ink};">${e(title)}</h1>
                <p style="margin: 0 0 16px; font-size: 15px; line-height: 24px; color: ${C.ink}; white-space: pre-wrap;">${e(data.message)}</p>
                ${contacts ? `<p style="margin: 0 0 20px; font-size: 15px; line-height: 24px;">${contacts}</p>` : ''}
                <a href="${e(data.consoleUrl)}" style="display: inline-block; background: ${C.primary}; color: #ffffff; font-size: 14px; font-weight: 600; line-height: 20px; padding: 10px 16px; border-radius: 8px; text-decoration: none;">Open messages</a>
              </td>
            </tr>
            <tr>
              <td style="padding: 20px 4px 0; font-size: 12px; line-height: 18px; color: ${C.muted};">
                Sent by ${PRODUCT_NAME} for ${e(data.propertyName)}. Change where these go in Voice → Settings.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** Tell the hotel's team a caller left a message or a booking request. Skips (logs) when Resend is not configured. */
export async function sendGuestRequestAlert(data: GuestRequestAlertData): Promise<void> {
  if (!resend) {
    console.log(`[email] Skipping message alert to ${data.to.join(', ')} (RESEND_API_KEY not configured)`);
    return;
  }
  const subject = `${data.booking ? 'Booking request' : 'New message'} from ${subjectText(data.guestName, 40) || 'a caller'} — ${subjectText(data.propertyName) || 'your hotel'}`;
  const text = [
    `${data.booking ? 'New booking request' : 'New message'} from ${data.guestName} (${data.channel})`,
    '',
    data.message,
    '',
    ...(data.phone ? [`Phone: ${formatPhone(data.phone)}`] : []),
    ...(data.email ? [`Email: ${data.email}`] : []),
    '',
    `Open messages: ${data.consoleUrl}`,
  ].join('\n');
  try {
    await resend.emails.send({
      from: fromAddress,
      to: data.to,
      ...(data.email ? { replyTo: data.email } : {}),
      subject,
      html: alertHtml(data),
      text,
    });
  } catch (error) {
    console.error('[email] Failed to send message alert:', error);
  }
}

export interface PasswordResetEmailData {
  to: string;
  firstName: string;
  /** Absolute one-time link to /reset-password?token=… */
  resetUrl: string;
  /** How long the link works, in minutes. */
  expiresInMinutes: number;
}

/**
 * Send the password-reset link. Without RESEND_API_KEY nothing is sent: in
 * development the link is printed to the server log so the flow can be tried;
 * in production only a warning is logged (a live reset link must never reach logs).
 */
export async function sendPasswordResetEmail(data: PasswordResetEmailData): Promise<void> {
  if (!resend) {
    if (process.env.NODE_ENV === 'production') {
      console.warn('[email] Password reset requested but RESEND_API_KEY is not configured — no email was sent.');
    } else {
      console.log(`[email] (dev) Password reset link for ${data.to}: ${data.resetUrl}`);
    }
    return;
  }
  const name = escapeHtml(subjectText(data.firstName) || 'there');
  const url = escapeHtml(data.resetUrl);
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:${C.page};font-family:${FONT};color:${C.ink}">
<div style="max-width:480px;margin:0 auto;background:${C.card};border:1px solid ${C.border};border-radius:12px;padding:28px">
<p style="margin:0 0 12px;font-size:18px;font-weight:600">Reset your ${PRODUCT_NAME} password</p>
<p style="margin:0 0 20px;font-size:15px;line-height:1.5">Hi ${name}, we got a request to reset the password for your account. This link works once and expires in ${data.expiresInMinutes} minutes.</p>
<p style="margin:0 0 24px"><a href="${url}" style="display:inline-block;background:${C.primary};color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:8px">Choose a new password</a></p>
<p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:${C.muted}">If the button doesn’t work, paste this address into your browser:<br><span style="word-break:break-all">${url}</span></p>
<p style="margin:0;font-size:13px;line-height:1.5;color:${C.muted}">Didn’t ask for this? You can ignore this email — your password won’t change.</p>
</div></body></html>`;
  const text = [
    `Hi ${subjectText(data.firstName) || 'there'},`,
    '',
    `We got a request to reset your ${PRODUCT_NAME} password. This link works once and expires in ${data.expiresInMinutes} minutes:`,
    data.resetUrl,
    '',
    'Didn’t ask for this? You can ignore this email — your password won’t change.',
  ].join('\n');
  try {
    await resend.emails.send({ from: fromAddress, to: data.to, subject: `Reset your ${PRODUCT_NAME} password`, html, text });
  } catch (error) {
    console.error('[email] Failed to send password reset email:', error);
  }
}

export interface DisputeAlertData {
  to: string[];
  propertyName: string;
  guestName: string | null;
  bookingCode: string | null;
  /** "150.00 USD" */
  amount: string;
  reason: string | null;
  /** When Stripe needs the evidence by, as a readable date, if known. */
  dueBy: string | null;
  /** Absolute link to the dispute in the console. */
  consoleUrl: string;
}

/**
 * Tell a hotel's owner a card payment was disputed and that the evidence is
 * ready to review. Nothing is submitted for them. Skips (logs) without Resend.
 */
export async function sendDisputeAlert(data: DisputeAlertData): Promise<boolean> {
  if (!resend) {
    console.log(`[email] Skipping dispute alert to ${data.to.join(', ')} (RESEND_API_KEY not configured)`);
    return false;
  }
  const subject = `A card payment was disputed — ${subjectText(data.propertyName)}${data.bookingCode ? ` (${subjectText(data.bookingCode)})` : ''}`;
  const e = escapeHtml;
  const facts = [
    ['Amount', data.amount],
    ...(data.bookingCode ? [['Booking', data.bookingCode]] : []),
    ...(data.guestName ? [['Guest', data.guestName]] : []),
    ...(data.reason ? [['Reason given', data.reason.replace(/_/g, ' ')]] : []),
    ...(data.dueBy ? [['Respond by', data.dueBy]] : []),
  ];
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:${C.page};font-family:${FONT};color:${C.ink}">
<div style="max-width:520px;margin:0 auto;background:${C.card};border:1px solid ${C.border};border-radius:12px;padding:28px">
<p style="margin:0 0 12px;font-size:18px;font-weight:600">A guest’s bank has disputed a payment</p>
<p style="margin:0 0 16px;font-size:15px;line-height:1.5">${e(data.propertyName)} received a card dispute. We put together the booking record, the policy the guest accepted, the 3D Secure result and the check-in details. Review it and submit it from the console when you’re ready — nothing is sent to the bank until you do.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;font-size:14px;line-height:22px">${facts.map(([k, v]) => `<tr><td style="padding-right:16px;color:${C.muted}">${e(k)}</td><td style="font-weight:600">${e(v)}</td></tr>`).join('')}</table>
<p style="margin:0 0 8px"><a href="${e(data.consoleUrl)}" style="display:inline-block;background:${C.primary};color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:8px">Review the evidence</a></p>
<p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:${C.muted}">Disputes have a deadline set by the card network. Winning is never certain, so the sooner you submit, the better.</p>
</div></body></html>`;
  const text = [
    `A guest’s bank has disputed a card payment at ${data.propertyName}.`,
    '',
    ...facts.map(([k, v]) => `${k}: ${v}`),
    '',
    'We assembled the evidence from the booking record. Review it and submit it yourself — nothing is sent to the bank until you do:',
    data.consoleUrl,
  ].join('\n');
  try {
    await resend.emails.send({ from: fromAddress, to: data.to, subject, html, text });
    return true;
  } catch (error) {
    console.error('[email] Failed to send dispute alert:', error);
    return false;
  }
}
