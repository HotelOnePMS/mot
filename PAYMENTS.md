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
   | `CRON_SECRET` | Optional, enables the hold-release cron route. |
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
- Tests for the pure logic (risk flags, deposit and refund maths, evidence summary): `npm test` (Node's built-in runner, no extra dependencies).
