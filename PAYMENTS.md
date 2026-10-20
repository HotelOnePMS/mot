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
   `checkout.session.completed`, `checkout.session.expired`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.amount_capturable_updated`, `payment_intent.canceled`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`, and (the *Connected accounts* endpoint) `account.updated`. Put each endpoint's signing secret in its own variable. The route verifies the signature against both secrets and is idempotent (`StripeEvent` table; a failed event is retried by Stripe).
4. **Database:** the migration `20261021_stripe_connect_payments` is additive and runs with `prisma migrate deploy` in the normal build.
5. **Optional cron:** add a Vercel Cron for `/api/cron/expire-bookings` and set `CRON_SECRET`.
6. Each hotel then opens *Settings → Online payments → Connect Stripe*, completes onboarding, and picks a policy. Until Stripe reports `charges_enabled`, the hotel stays on pay-at-property.

## Front desk payments

Staff collect the balance and a security deposit at check-in (or any time in the stay) from the check-in dialog or the reservation page (*At the desk*). Every way of paying writes a `Payment` row with a `method`:

| Method | How | Stripe |
| --- | --- | --- |
| `TERMINAL` | Card reader (Stripe Terminal smart reader: WisePOS E or S700). The desk sends the amount, the guest taps, inserts or swipes. | Server-driven: a `card_present` PaymentIntent on the hotel's account, then `terminal.readers.processPaymentIntent`. |
| `CARD_ENTRY` | Staff type the guest's card into Stripe's page (opened in a new tab). | A Checkout session on the hotel's account, 3D Secure requested (`any`). |
| `VIRTUAL_CARD` | The OTA's virtual card (Booking.com VCC, Expedia EVC) typed into Stripe's page from the OTA extranet. | Same as above, 3D Secure left to the bank (no cardholder to answer it). |
| `CASH` | A ledger entry: amount, cash handed over, change, who took it. | None. |

- **Kinds:** `PAYMENT` goes toward the stay's balance (booking `paymentStatus` becomes `DEPOSIT_PAID` / `PAID`); `SECURITY_DEPOSIT` is kept out of the balance and the revenue figures. A reservation of several room types is paid on its lead line, like online payments.
- **Security deposit** (*Settings → Front desk payments*): none, **Hold on the card** (manual capture; on a reader with `request_extended_authorization`, so lodging holds last up to 30 days; typed-in cards get 7 days unless `STRIPE_EXTENDED_AUTHORIZATION=1`), or **Charge and refund** (card or cash). At check-out, *Return deposit…* keeps part for incidentals (a note is required) and returns the rest: a hold is captured for that amount or released, a charge is refunded, cash is recorded as handed back.
- **Webhook and polling:** desk PaymentIntents and Checkout sessions carry `metadata.deskPaymentId`. The webhook applies them (`payment_intent.*`, `checkout.session.*`), and the desk polls `/api/admin/desk-payments/:id` while the guest pays, so it works even before the webhook is set up. Both paths are idempotent.
- **OTA cards:** card numbers and security codes are removed from OTA payloads before they are stored (`ChannelReservation.rawPayload`) or logged. What the desk needs is kept in `ChannelReservation.paymentCard`: virtual or guest card, brand, last four, expiry, and for a virtual card the date it can be charged from, until when, and its balance. The desk refuses to charge a virtual card before its activation date or above its balance. Sandbox channel bookings come with a test virtual card (charge it with `4242 4242 4242 4242` in test mode). Charging the card automatically, without staff typing it, would need HotelOne to hold card numbers (PCI DSS SAQ D, or a card vault), which it deliberately doesn't.
- **Permissions:** `payments.collect` (admin, owner, manager, front desk) takes payments and deposits; handing back cash paid toward the stay needs `payments.refund`; deposit settings and readers need `payments.manage`.

### Setting up a card reader

1. The hotel connects Stripe (*Settings → Online payments*) and waits for charges to be enabled.
2. Buy a Stripe Terminal smart reader for the hotel's country (WisePOS E or S700) in the hotel's Stripe Dashboard (*Terminal → Shop*), connect it to the desk's Wi-Fi.
3. On the reader: *Settings → Generate pairing code*. In HotelOne: *Settings → Front desk payments → Card readers*, enter the code and a name. HotelOne creates the hotel's Terminal location from its address on first use.
4. Test mode: *Add a simulated reader*, then use *Simulate tap* in the payment dialog (or *Simulate declined card*).

## Permissions and tenant isolation

`payments.view` (admin, owner, manager) · `payments.manage` (admin, owner) · `payments.refund` (admin, owner, manager) · `disputes.view` (admin, owner, manager) · `disputes.manage` (admin, owner). Every admin endpoint calls `requireStaff(permission)` and then scopes by the signed-in user's properties (`assertPropertyAccess`, `scopeByProperty`, `getBookingForStaff`), so staff can only read or act on their own hotel's payments, refunds, checklists and disputes.

## PCI

Card details are entered only on Stripe-hosted Checkout or on a Stripe Terminal reader, so for guest and desk payments HotelOne qualifies for **SAQ A**: we never receive, transmit or store card numbers, CVC or expiry. One exception to know about: when an OTA connection is live, Booking.com and Expedia can include card numbers in the reservation messages the channel manager pulls. HotelOne drops them before anything is stored or logged and keeps only brand, last four and expiry, but receiving them at all is in PCI scope. To stay strictly SAQ A, leave card details out of the OTA's reservation feed (staff read them in the extranet instead); the desk works the same either way. The `Payment` record keeps only what Stripe reports about the payment (brand, last four, card country, 3DS result, risk level).

## Notes

- The cancellation/refund wording in `src/lib/payments.ts` is a **draft** and needs legal review for your markets. Changing it changes the stored hash (acceptances already recorded keep the text the guest saw).
- Bookings made through the concierge/voice agent API create pay-at-property bookings and do not go through the policy checkbox or Checkout.
- Cancelling a booking does not refund automatically; refund from the booking page.
- Online payments are in USD (`PAYMENT_CURRENCY`).
- Tests for the pure logic (risk flags, deposit and refund maths, evidence summary): `npm test` (Node's built-in runner, no extra dependencies).
