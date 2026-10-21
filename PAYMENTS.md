# Online payments (Stripe Connect)

Hotels can take card payments through their own Stripe account. Everything is optional and runs on environment variables: **without `STRIPE_SECRET_KEY`, or for a hotel that hasn't finished Stripe onboarding, bookings work exactly as before (pay at the property).**

## How it works

- **Connect Express, direct charges.** Each hotel connects its own Stripe account from *Admin → Settings → Online payments*. Charges are created **on the hotel's account** (`stripeAccount` option), so funds go straight to the hotel, the hotel is the merchant of record, and any dispute lands on its account. HotelOne can keep an optional platform fee (`STRIPE_PLATFORM_FEE_PERCENT`, sent as `application_fee_amount`).
- **Payment policy per hotel:** pay at property (default), a deposit of N nights (default 1, max 14), or full prepayment. The guest accepts the cancellation/refund policy at booking (checkbox); we store the policy version, a SHA-256 of the exact text shown, the timestamp, IP and user agent (`BookingPolicyAcceptance`). The server rejects the booking (409) if the hash doesn't match the current policy text.
- **Hosted Stripe Checkout** with `billing_address_collection: required` and `payment_method_options.card.request_three_d_secure: 'any'` (3D Secure is requested on every card payment; the issuer/Stripe Radar decide whether a challenge is shown, and a payment can still be disputed).
- **Booking is confirmed only after the webhook reports success.** A booking waiting for payment is `PENDING` / `AWAITING_PAYMENT` and holds its rooms for 35 minutes (`expiresAt`). Holds are released by the `checkout.session.expired` event, by a sweep on every new booking, and optionally by `/api/cron/expire-bookings`. If a payment arrives after expiry, the booking is reinstated when the rooms are still free; otherwise a note is added to its history saying a refund is needed.
- **Payment record** (`Payment`): cardholder name, billing email, billing country, card brand/last4/country, 3DS result, Stripe risk level and score, amount, currency, PaymentIntent id and status. It is kept separate from the guest's name.
- **Risk flags** are computed on the server whenever a booking is read (never stored, never sent to guest endpoints): cardholder differs from guest · card country differs from guest/billing country · high amount · Stripe risk elevated / highest · 3DS not completed or unavailable. Badges show on *Reservations* and the booking page. Flagged bookings get a check-in checklist (ID matches guest, card shown if required, registration signed). Staff tick it; we store who and when.
- **Refunds** (full or partial) from the booking page, with a suggested amount from the cancellation policy. The `charge.refunded` webhook is the source of truth for status.
- **Disputes:** on `charge.dispute.created` we create a `Dispute` record, email the hotel's owner(s) through Resend, and assemble an evidence summary (booking details, policy acceptance, 3DS result, check-in time, checklist, guest emails). View and download it in *Admin → Disputes*. **Nothing is sent to Stripe automatically**: *Submit evidence* calls Stripe's disputes API only when an admin with `disputes.manage` clicks it. Evidence is text only (no file uploads); the hotel can add documents in its Stripe Dashboard.

## Someone else pays: cardholder authorization

When the person paying isn't the guest checking in (a parent, a company, a friend), or isn't there at all, staff ask the cardholder to sign an authorization from the reservation page (*Cardholder authorization → Ask the cardholder to sign*). It works for card payments made online and for cards charged at the desk.

- **Sending it.** Staff enter the cardholder's name (prefilled from Stripe when the card is in another name), optionally their email, the guests the card pays for, and whether it covers incidentals (optionally up to a limit). They get a one-time link to email, copy into a text or WhatsApp, show as a QR code for the cardholder's own phone, or open on the desk's device. Only a hash of the link's token is stored; a link works for 7 days, a newer link replaces it, and staff can cancel it.
- **What the cardholder fills in** (`/authorize/<token>`, no account): full name, email, phone (optional), billing address, the card's **last four digits** (and its type when no card was charged online), their photo ID's type, issuing country and last four characters, a **photo of the ID**, and a signature, drawn on screen or typed (keyboard and screen-reader users type). They agree to the wording shown; we store it with its version and SHA-256, the IP address and device, and a SHA-256 over everything signed (`documentHash`). They get a copy by email.
- **Matching.** When the stay was paid online, the last four digits must match that card. After 5 wrong tries the link locks and staff are told. The name, billing country and email are compared with what Stripe reported, and the name with whom staff asked; mismatches are shown to staff, never auto-rejected.
- **Review.** Staff look at the ID photo (served from an authenticated endpoint, never cached, every view logged) and **Verify** it or **Reject** it with a reason. A verified authorization covers "Card used to pay was shown" on the check-in checklist, and every signed authorization goes into the dispute evidence (*Cardholder authorization* section and Stripe's `uncategorized_text`).
- **Privacy.** Card numbers are never collected: last four digits only, and the form tells people not to send a photo of their card (PCI SAQ A is unchanged). ID photos are sealed with the vault (`HOTELONE_VAULT_KEY`; without it, the form asks for ID details without a photo) and deleted `CARD_AUTH_ID_PHOTO_DAYS` (default 180) after check-out unless a dispute is open, by `/api/cron/expire-bookings` and now and then during normal use. Nothing about the payer is written to the booking's status history, which guests see on their booking page; staff actions and the signing are in the activity log.
- **Permission:** `booking.cardAuth` (admin, owner, manager, front desk). Staff only reach their own hotels' authorizations.
- The authorization wording in `src/lib/card-authorization.ts` is a **draft**, like the cancellation policy: have it reviewed for your markets, and bump `CARD_AUTH_VERSION` when it changes.

## Setup

1. **Stripe Dashboard → Connect → Settings:** enable Connect, choose Express accounts, and add your platform branding. In test mode, use `sk_test_…`.
2. **Environment variables** (see `.env.example`):

   | Variable | Purpose |
   | --- | --- |
   | `STRIPE_SECRET_KEY` | Platform secret key. Enables the whole feature. |
   | `STRIPE_WEBHOOK_SECRET` | Signing secret of the *Your account* endpoint. |
   | `STRIPE_CONNECT_WEBHOOK_SECRET` | Signing secret of the *Connected accounts* endpoint. |
   | `STRIPE_PLATFORM_FEE_PERCENT` | Optional fee, e.g. `1.5`. |
   | `STRIPE_CONNECT_DEFAULT_COUNTRY` | Optional default country for new Express accounts. |
   | `PAYMENTS_HIGH_AMOUNT_THRESHOLD` | Optional, default `1000`. |
   | `CARD_AUTH_ID_PHOTO_DAYS` | Optional, default `180`: days after check-out a card authorization's ID photo is kept (longer while a dispute is open). |
   | `CRON_SECRET` | Optional, enables the hold-release cron route (which also deletes expired ID photos). |
   | `NEXT_PUBLIC_SITE_URL` | Used for Checkout and onboarding return URLs. |
   | `RESEND_API_KEY`, `EMAIL_FROM` | Dispute alerts and booking emails. |

3. **Webhook.** Add the same URL, `https://<your-domain>/api/webhooks/stripe`, **twice**: once as an endpoint for *Your account* and once for *Connected accounts* (direct charges and disputes happen on the hotels' accounts). Subscribe both to:
   `checkout.session.completed`, `checkout.session.expired`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`, and (the *Connected accounts* endpoint) `account.updated`. Put each endpoint's signing secret in its own variable. The route verifies the signature against both secrets and is idempotent (`StripeEvent` table; a failed event is retried by Stripe).
4. **Database:** the migration `20261021_stripe_connect_payments` is additive and runs with `prisma migrate deploy` in the normal build.
5. **Optional cron:** add a Vercel Cron for `/api/cron/expire-bookings` and set `CRON_SECRET`.
6. Each hotel then opens *Settings → Online payments → Connect Stripe*, completes onboarding, and picks a policy. Until Stripe reports `charges_enabled`, the hotel stays on pay-at-property.

## Permissions and tenant isolation

`payments.view` (admin, owner, manager) · `payments.manage` (admin, owner) · `payments.refund` (admin, owner, manager) · `disputes.view` (admin, owner, manager) · `disputes.manage` (admin, owner). Every admin endpoint calls `requireStaff(permission)` and then scopes by the signed-in user's properties (`assertPropertyAccess`, `scopeByProperty`, `getBookingForStaff`), so staff can only read or act on their own hotel's payments, refunds, checklists and disputes.

## PCI

Card details are entered only on Stripe-hosted Checkout, so HotelOne qualifies for **SAQ A**. We never receive, transmit or store card numbers, CVC or expiry. The `Payment` record keeps only what Stripe reports about the payment (brand, last four, card country, 3DS result, risk level).

## Notes

- The cancellation/refund wording in `src/lib/payments.ts` is a **draft** and needs legal review for your markets. Changing it changes the stored hash (acceptances already recorded keep the text the guest saw).
- Bookings made through the concierge/voice agent API create pay-at-property bookings and do not go through the policy checkbox or Checkout.
- Cancelling a booking does not refund automatically; refund from the booking page.
- Online payments are in USD (`PAYMENT_CURRENCY`).
- Tests for the pure logic (risk flags, deposit and refund maths, evidence summary, card authorization wording and matching): `npm test`. The card authorization flow end to end (signing, locking, review, retention, evidence) is in `tests/integration/card-authorization.test.ts`.
