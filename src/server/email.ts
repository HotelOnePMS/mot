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
  paymentStatus: string;
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

const oneLine = (v: string) => v.replace(/[\r\n]+/g, ' ').trim();

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
    paid,
    details,
    paymentLabel: paid ? 'Paid online' : 'Pay at the hotel',
    paymentNote: paid ? 'Your payment has been received.' : 'Nothing has been charged — you’ll pay the hotel during your stay.',
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
      subject: `Booking confirmed — ${oneLine(data.propertyName)}`,
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
  const subject = `${data.booking ? 'Booking request' : 'New message'} from ${oneLine(data.guestName)} — ${oneLine(data.propertyName)}`;
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
