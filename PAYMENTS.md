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
   `checkout.session.completed`, `checkout.session.expired`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.amount_capturable_updated`, `payment_intent.canceled`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`, and (the *Connected accounts* endpoint) `account.updated`. Put each endpoint's signing secret in its own variable. The route verifies the signature against both secrets and is idempotent (`StripeEvent` table; a failed event is retried by Stripe).
4. **Database:** the migration `20261021_stripe_connect_payments` is additive and runs with `prisma migrate deploy` in the normal build.
5. **Optional cron:** add a Vercel Cron for `/api/cron/expire-bookings` and set `CRON_SECRET`.
6. Each hotel then opens *Settings → Online payments → Connect Stripe*, completes onboarding, and picks a policy. Until Stripe reports `charges_enabled`, the hotel stays on pay-at-property.

## Front desk payments

Staff collect the balance and a security deposit at check-in (or any time in the stay) from the guided check-in or the reservation page (*At the desk*). Every way of paying writes a `Payment` row with a `method`:

| Method | How | Stripe |
| --- | --- | --- |
| `TERMINAL` | Card reader (Stripe Terminal smart reader: WisePOS E or S700). The desk sends the amount, the guest taps, inserts or swipes. | Server-driven: a `card_present` PaymentIntent on the hotel's account, then `terminal.readers.processPaymentIntent`. |
| `CARD_ENTRY` | Staff type the guest's card into Stripe's page (opened in a new tab). | A Checkout session on the hotel's account, 3D Secure requested (`any`). |
| `VIRTUAL_CARD` | The OTA's virtual card (Booking.com VCC, Expedia EVC) typed into Stripe's page from the OTA extranet. | Same as above, 3D Secure left to the bank (no cardholder to answer it). |
| `CASH` | A ledger entry: amount, cash handed over, change, who took it. | None. |
| `EXTERNAL_CARD` | A card taken on the hotel's own terminal (not Stripe), recorded with the last four digits and the approval code. | None. |
| `OTHER` | Paid another way (bank transfer, voucher, city ledger), recorded with a note saying how. | None. |

A full card number typed into a note or an approval code (13 to 19 digits passing the Luhn check) is refused: card numbers are never stored. Status history notes, which guests read on their booking page, never name the card.

- **Kinds:** `PAYMENT` goes toward the stay's balance (booking `paymentStatus` becomes `DEPOSIT_PAID` / `PAID`); `SECURITY_DEPOSIT` is kept out of the balance and the revenue figures. A reservation of several room types is paid on its lead line, like online payments.
- **Security deposit** (*Settings → Front desk payments*): none, **Hold on the card** (manual capture; on a reader with `request_extended_authorization`, so lodging holds last up to 30 days; typed-in cards get 7 days unless `STRIPE_EXTENDED_AUTHORIZATION=1`), or **Charge and refund** (card or cash). At check-out, *Return deposit…* keeps part for incidentals (a note is required) and returns the rest: a hold is captured for that amount or released, a charge is refunded, cash is recorded as handed back.
- **Webhook and polling:** desk PaymentIntents and Checkout sessions carry `metadata.deskPaymentId`. The webhook applies them (`payment_intent.*`, `checkout.session.*`), and the desk polls `/api/admin/desk-payments/:id` while the guest pays, so it works even before the webhook is set up. Both paths are idempotent.
- **OTA cards:** card numbers and security codes are removed from OTA payloads before they are stored (`ChannelReservation.rawPayload`) or logged. What the desk needs is kept in `ChannelReservation.paymentCard`: virtual or guest card, brand, last four, expiry, and for a virtual card the date it can be charged from, until when, and its balance. The desk refuses to charge a virtual card before its activation date or above its balance. Sandbox channel bookings come with a test virtual card (charge it with `4242 4242 4242 4242` in test mode). Charging the card automatically, without staff typing it, would need HotelOne to hold card numbers (PCI DSS SAQ D, or a card vault), which it deliberately doesn't.
- **Hold or charge:** a card deposit follows the hotel's setting (no setting means a hold), and staff can switch it to a hold or a charge in the dialog. Suggested amounts are 50, 100 and the hotel's own amount, or a custom one. A typed-in card can also be paid by the guest on their phone: the dialog shows a QR code of Stripe's page.
- **Check-out needs a zero balance.** Every booking carries a signed `balance` (room, taxes and fees less allowances and everything paid online or at the desk; a held security deposit doesn't count) and `checkOutDue`, what must be paid before check-out. Check-out is refused while `checkOutDue` is above zero, on every path (the dialogs, the API, the agent), so money taken outside Stripe must be recorded as `EXTERNAL_CARD` or `OTHER` first. A credit owed to the guest doesn't block check-out. For a room type of a reservation paid together, `checkOutDue` is what the whole reservation still owes (the figure the desk collects): its share is spread over every room type, so a part payment doesn't clear one room type on its own. Kept deposit money covers incidentals and doesn't pay the room.
- **Allowances** (managers, `folio.adjust`): *Add allowance…* on the folio lowers what the stay costs, with a reason (service recovery, unused nights, a rate correction), at most the charges not already allowed. It lowers the balance, `checkOutDue`, the desk's balance and the paid status, shows on the folio (as a line under the charges), on the registration card ("Allowances: … off") and in dispute evidence, and is audited. *Remove* puts the charges back; the allowance stays on record with who removed it. A refund toward the stay brings the balance back, so a goodwill or unused-nights refund can tick *Also take this amount off what the stay costs*, which adds the matching allowance (checked before the refund is sent to Stripe; one allowance per refund even if the request is sent twice). When the guest already has a credit because an allowance came first, the refund goes back as it is, without another allowance. Allowances are rounded to the currency's smallest unit; a stay repriced below its allowances costs nothing (never less), and a guest can't change the dates online of a stay with an allowance (the front desk does). A stay allowances took entirely off counts as paid. In a reservation of several room types, money paid beyond what is now due is the credit of the room type whose allowance made it. Reports count room revenue before allowances.
- **Check out with a balance** (managers, `booking.checkoutWithBalance`): when money is still owed (billed to a company, paying later, a disputed charge), a manager can check the guest out from the check-out dialog with a reason. What was owed, the reason and who approved it are kept (`CheckoutOverride`) and audited, never written to the guest's history; the folio keeps showing the balance, and the desk can still collect it. The guided check-in migration records a payment for bookings already marked paid at the desk (on the reservation's lead line when shared), so they aren't blocked.
- **Permissions:** `payments.collect` (admin, owner, manager, front desk) takes payments and deposits; handing back cash paid toward the stay needs `payments.refund`; deposit settings and readers need `payments.manage`.

### Guided check-in

*Check in* walks the desk through five steps, and nothing is saved until the last one; then everything is saved in the same transaction as the check-in (`src/server/services/checkin.ts`):

1. **Photo ID.** Scan the barcode on the back of a North American driver's licence (AAMVA PDF417) or the machine-readable lines of a passport or ID card (ICAO 9303, check digits verified) with a keyboard-style desk scanner, photograph the barcode (browsers with `BarcodeDetector`), or type the details. Staff take a photo of the front and confirm the ID belongs to the guest. An expired ID, a different name or a guest under 18 needs a reason. Parsing happens on the device (`src/lib/id-scan.ts`).
2. **Room**, from the free rooms of the booked type.
3. **Folio**: room, taxes and fees, payments and refunds, the balance, and security deposits listed apart. Staff can take the balance here; it isn't required to check in, only to check out. The folio is also on the reservation page (`src/server/services/folio.ts`).
4. **Security deposit**, through the desk payments dialog (card reader, the guest's card online as a hold, cash, the hotel's own terminal), or no deposit (with a reason when the hotel asks for one; logged).
5. **Registration card.** The server writes the card from the database (hotel, guest, stay, room, amounts, deposit, ID type and last four, check-out time, house terms) and hashes it; the guest reads it on the desk's screen, agrees and signs by drawing or typing their name. If anything on the card changed before signing (a payment, the room), the check-in is refused and the guest signs the new card.

What is kept: the ID's type, issuing country, last four characters, expiry and name in clear; the full number, date of birth and address read from the ID sealed with the vault, and the front photo sealed in its own table (staff with `guestId.view` can open them; every view is logged). Both sealed parts are deleted `CARD_AUTH_ID_PHOTO_DAYS` after check-out unless a dispute is open on the stay or on any room type of its reservation. The registration card is kept as signed, like a paper card: its exact text (including the home address printed on it, which staff can edit before the guest signs), version, signature (a drawn image, or the typed name), IP and device, who witnessed it, and `documentHash`, the SHA-256 of `signedRecord`, the exact record of what was signed, stored with it so the hash can be checked later. A recorded ID covers "ID matches guest" on the check-in checklist, a signed card covers "Registration signed", and both go into dispute evidence. Nothing about the ID goes into the booking's status history, which the guest can read. A guest checked in another way (the agent, a walk-in) can have the ID and card added afterwards from the reservation page.

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
- Tests for the pure logic (risk flags, deposit and refund maths, evidence summary, card authorization wording and matching): `npm test`. The card authorization flow end to end (signing, locking, review, retention, evidence) is in `tests/integration/card-authorization.test.ts`.
