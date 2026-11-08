# Channel Manager & Channel Agent

HotelOne can distribute a hotel's rooms on **Expedia** (with Hotels.com and Vrbo), **Booking.com**, **Google Hotels**
(free booking links), **Airbnb**, **Agoda**, **Trip.com**, **Hopper**, **Priceline** and **Hostelworld**. It keeps rates,
availability and restrictions in sync, imports OTA reservations as HotelOne bookings, and publishes promotions where the
OTA allows it. Every channel works in sandbox mode today; live mode needs partner access (see
[Going live with the OTAs](#going-live-with-the-otas)).
The **Channel Agent** is an AI assistant that makes the same changes from plain-English requests
such as "raise weekend rates on Booking.com by 10% for November".

It is for hotels that take their bookings in HotelOne (the `FULL` setup path). Bridge and voice-only hotels keep
their reservations in their own system, so HotelOne can't tell an OTA what's free; they connect the OTAs there.

Console pages (Revenue → **Channels**):

| Page | What it does |
| --- | --- |
| `/admin/channels` | The selected property's OTA connections, latest OTA reservations, sync activity |
| `/admin/channels/connect` | Onboarding wizard (channel & mode, credentials, room mapping, pricing, go live) |
| `/admin/channels/[id]` | Manage one connection: rate grid and bulk changes, promotions, reservations, activity log, settings |
| `/admin/channels/agent` | Chat with the Channel Agent |

Who can do what (`src/server/authz.ts`), always limited to the properties assigned to the person:

| Permission | Roles | Covers |
| --- | --- | --- |
| `channels.view` | admin, owner, manager | See connections, calendars, promotions; sync now; use the Channel Agent |
| `rates.write` | admin, owner, manager | Channel prices, restrictions, markups, promotions (screens and agent) |
| `channels.manage` | admin, owner | Connect an OTA, credentials, room mapping, activate/pause, disconnect, sandbox test bookings |

## Onboarding a property

1. **Channel & mode**: pick the property, the channel, and a mode:
   - **Sandbox** simulates the OTA locally. It needs only a property ID (any value), mirrors your PMS
     room types as OTA rooms, accepts rate pushes and promotions, and lets you inject test bookings
     with **Simulate booking**. Use it to try the whole flow.
   - **Live** talks to the real OTA API with connectivity-partner credentials. For Booking.com, Expedia, Airbnb,
     Agoda, Trip.com and Hostelworld you can instead connect **through Channex** (see below).
2. **Connect**: enter the OTA property ID (and API credentials in live mode), then test the
   connection. Passwords are sealed with the vault (`HOTELONE_VAULT_KEY`, `src/server/vault.ts`), bound to their
   connection, and never sent back to the browser. Shared demo hotels can only use sandbox mode.
3. **Map rooms**: link each PMS room type to an OTA room and rate plan. Matches by name are suggested.
   You can set a per-room markup and a **max rooms** allocation (caps what the channel can sell per night).
4. **Pricing & sync**: default markup (e.g. 15% to cover commission), which data to sync, and how many
   days ahead to keep open (default 365).
5. **Go live**: activation pushes availability and rates for the whole window and pulls reservations.

## How prices and availability are calculated

For every mapped room type and night:

- **Price sent to the OTA** = the channel-specific price for that date if one is set, otherwise
  `PMS rate x (1 + markup)`. The PMS rate is the Rates calendar value, falling back to the room type's base price.
- **Availability** = total rooms - rooms sold that night (bookings from every source, the same count the
  booking site uses: `src/server/services/inventory.ts`), capped by the channel allocation.
- **Restrictions**: stop-sell (closed) and minimum stay, per channel and date.

Consecutive nights with identical values are collapsed into date ranges, so a year of flat pricing is a
single update.

Updates are pushed automatically when:

- a rate is saved on the Rates page or by the agent (`/api/admin/room-types/[id]/rates`, `src/server/services/rates.ts`)
- a booking is created (any source, `createBooking`), cancelled, marked no-show, reinstated, checked out early,
  or a guest changes or cancels it online; an unpaid online checkout expires
- a room type's room count or base price changes
- an OTA reservation is imported, modified or cancelled (other channels get the new availability)
- a channel price, restriction, markup or mapping changes

These pushes run after the response is sent (`after()` from `next/server`) and never block or fail the
operation; failures are recorded in the connection's activity log and shown on the Channels page.

## Channels

| Channel | Direct API | Reservations | Room codes | Promotions | Through Channex |
| --- | --- | --- | --- | --- | --- |
| Expedia | EQC XML | pulled (BR/BC) | from Expedia | yes | yes |
| Booking.com | B.XML + OTA | pulled | from Booking.com | yes | yes |
| Google Hotels | Hotel Center ARI (OTA messages + Transaction) | none: links open the HotelOne booking site | HotelOne's | yes (Promotions feed) | no |
| Airbnb | Airbnb API (JSON) | webhook | Airbnb listing IDs | no | yes |
| Agoda | Supply OTA API 2015B | webhook (OTA_HotelResRQ / OTA_CancelRQ) | HotelOne's | no | yes |
| Trip.com | OTA messages, POS credentials | webhook (OTA_HotelResNotif / ResModifyNotif) | HotelOne's | no | yes |
| Hopper | standard OTA messages (spec not public) | webhook | HotelOne's | no | no |
| Priceline | standard OTA messages (spec not public) | webhook | HotelOne's | no | no |
| Hostelworld | standard OTA messages (spec not public) | webhook | HotelOne's | no | yes |

Adapters live in `src/server/channels/adapters/` (`google-hotels.ts`, `airbnb.ts`, `ota-partner.ts` for Agoda, Trip.com,
Hopper, Priceline and Hostelworld, `channex.ts`, shared OpenTravel pieces in `opentravel.ts`). What each channel needs is
described in one place, `src/lib/channels/catalog.ts`, which the wizard and the Channels page read.

- **HotelOne's room codes**: for OTAs where the hotel maps rooms in the OTA's extranet, HotelOne publishes a stable code per
  room type (`HO` + 8 hex characters, `pms-codes.ts`) and the rate code `BAR`. The mapping step shows them so the hotel can
  enter them in the extranet.
- **Webhooks**: live connections to webhook OTAs show a private URL,
  `/api/channels/webhooks/<connectionId>?token=…`. The token is derived from `HOTELONE_VAULT_KEY`, so rotating that key
  changes every webhook URL. The reply is in the OTA's own format (an OpenTravel RS with HotelOne's confirmation code, or
  JSON for Airbnb). A message that can't be applied is answered with an error so the OTA retries or alerts the hotel.
- **Google free booking links**: Google never takes the booking. Upload the Point of Sale file from
  `/api/channels/google/point-of-sale` in Hotel Center; links land on `/api/channels/google/landing`, which opens the
  hotel's HotelOne booking page for the dates picked on Google. Those bookings are ordinary website bookings.
- **Channex**: with "Connect through Channex", HotelOne pushes availability and rates to a Channex property and pulls the
  Channex booking feed (acknowledging each revision once saved). The OTA itself is connected and mapped inside Channex.
  One Channex property can serve several OTAs; each HotelOne connection only imports its own OTA's revisions.

## Reservations

OTA reservations are **pulled** (Expedia Booking Retrieval / Booking.com `OTA_HotelResNotif` and
`OTA_HotelResModifyNotif`, the Channex booking feed) or **pushed** to the webhook (Airbnb, Agoda, Trip.com, Hopper,
Priceline, Hostelworld), turned into PMS bookings with `source` = the channel (`EXPEDIA`, `AIRBNB`, …) and status
`CONFIRMED`, then confirmed back to the OTA with the booking's short confirmation code. Modifications update the booking;
cancellations cancel it and release the rooms. A reservation covering several room types is split into one
PMS booking per room type. OTA reservations are always recorded, even if they overbook (the OTA has already
confirmed them to the guest); the status history notes `OVERBOOKED` when that happens.

Each OTA reservation gets its own guest record (inactive, no password, an undeliverable
`@ota-guests.hotelone.invalid` address) so the front desk sees the name and phone; the email the OTA sent is
kept on the booking. An OTA message can never attach a booking to an existing account, the same rule as
direct bookings through the agent API. Card details are not imported; bookings are marked pay at property.

Reservations are pulled on activation, on **Sync now**, and by the cron endpoint below.

## Promotions

Types: **Basic**, **Early booker** (book at least N days ahead), **Last minute** (book within N days),
**Multi-night** (minimum stay of 2 or more nights), each with a percentage discount, stay window and
optional booking window. Promotions can be paused and resumed. If the OTA rejects one, it is kept with
status `FAILED` and the OTA's error message, and can be retried.

## Channel Agent

The agent runs a function-calling loop on the OpenAI Responses API (`src/server/channel-agent/`), like the PMS
MCP planner. Every tool runs as the person chatting: it sees only their properties, and changes need
`rates.write`. Conversations are replayed from the database each turn (`store: false`), so nothing depends on
OpenAI keeping earlier responses. Tools:

| Tool | Changes data? |
| --- | --- |
| `list_channel_connections`, `get_channel_calendar`, `list_promotions`, `get_recent_activity` | no |
| `sync_channels` (re-push current state, pull reservations) | no pricing change |
| `update_rates` (channel-only or PMS-wide), `set_restrictions`, `set_channel_markup`, `create_promotion`, `update_promotion` | **yes** |

- Every change is previewed (old to new prices, affected room types and dates, warnings) and **waits for
  the admin's approval** by default. Untick "Ask me before applying changes" to let it apply changes directly.
- Every proposed change is recorded in `channel_agent_actions` as executed, rejected or failed.
- The same guardrails apply as in the UI: no past dates, at most 366 days per change, prices $1-$10,000,
  increases up to 200%, decreases up to 90%, discounts 1-80%.
- The model is `CHANNEL_AGENT_MODEL` (default `OPENAI_VOICE_BACKEND_MODEL`, then `gpt-6-luna`). Each request
  makes a few model calls, so it has API costs.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | for the agent | Already used by voice and the bridge; switches the Channel Agent on |
| `CHANNEL_AGENT_MODEL` | no | Model for the Channel Agent (default `OPENAI_VOICE_BACKEND_MODEL`) |
| `CRON_SECRET` | for scheduled sync | Bearer token for `/api/channels/cron` (Vercel Cron sends it automatically) |
| `HOTELONE_VAULT_KEY` | prod, live mode | Seals OTA passwords (same key as the PMS bridge) |
| `EXPEDIA_EQC_BASE_URL` | no | EQC endpoint base (default `https://services.expediapartnercentral.com`) |
| `EXPEDIA_API_BASE_URL` | no | Expedia promotions API base (same default) |
| `BOOKING_COM_SUPPLY_URL` | no | Default `https://supply-xml.booking.com` |
| `BOOKING_COM_SECURE_URL` | no | Default `https://secure-supply-xml.booking.com` (reservations) |
| `GOOGLE_HOTELS_ARI_BASE_URL` | no | Default `https://www.google.com/travel/hotels/uploads` |
| `AIRBNB_API_KEY` | Airbnb live | Partner API key issued by Airbnb |
| `AIRBNB_API_BASE_URL` | no | Default `https://api.airbnb.com/v2` |
| `AGODA_OTA_URL` | no | Default `https://supplyota.agoda.com/b2b/ota/2015B/hotels` |
| `TRIP_COM_OTA_URL` | Trip.com live | Endpoint Trip.com gives you during onboarding |
| `HOPPER_OTA_URL` | Hopper live | Endpoint Hopper gives you during onboarding |
| `PRICELINE_OTA_URL` | Priceline live | Endpoint Priceline gives you during onboarding |
| `HOSTELWORLD_OTA_URL` | Hostelworld live (direct) | Endpoint Hostelworld gives you during onboarding |
| `CHANNEX_API_BASE_URL` | no | Default `https://app.channex.io/api/v1`; use `https://staging.channex.io/api/v1` to test |

The URL overrides let you point a live connection at an OTA certification/test environment.

## Scheduled sync

`vercel.json` runs `/api/channels/cron?full=1` once a day: it imports new OTA reservations and re-pushes the
full availability/rate window as a reconciliation. Set `CRON_SECRET` in Vercel and Vercel Cron sends it.

Once a hotel is live on a real OTA, reservations should be pulled more often. On a Vercel plan that allows it,
add a second cron entry for `/api/channels/cron` every 5 minutes; anywhere else:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<your-host>/api/channels/cron
```

## Database

`prisma/migrations/20261023_channel_manager` adds the channel tables (OTA bookings reuse the existing
`bookings.source` column). `20261108_more_otas` adds the new `OtaChannel` values and the nullable
`channel_connections.connectivityProvider` column. Both are additive and run with the normal deploy
(`scripts/vercel-build.mjs` applies migrations).

## Going live with the OTAs

Every OTA here only gives API access to **approved connectivity partners**. There are two routes:

- **Through Channex** (Booking.com, Expedia, Airbnb, Agoda, Trip.com, Hostelworld): sign a Channex white-label agreement.
  Channex already holds the OTA certifications, so this is the quickest way to take live bookings.
- **Direct**: apply to each OTA's partner program and pass its certification. Google Hotels, Hopper and Priceline are
  direct only. Hopper, Priceline, Hostelworld, Trip.com and Airbnb don't publish their APIs; their adapters follow
  standard OpenTravel (or Airbnb's known JSON) shapes and will need changes once the OTA shares its spec.

Google Hotels also needs fixed outbound IP addresses (Google only accepts ARI from IPs allowlisted in Hotel Center).
Vercel functions have none by default, so use Vercel Static IPs (Secure Compute) or a fixed-IP proxy.

For Expedia and Booking.com directly, the business running this PMS has to:

1. Apply to the Expedia Group connectivity program and the Booking.com Connectivity Partner program.
2. Pass each OTA's certification. The adapters (`src/server/channels/adapters/`) build messages from the
   published EQC (AR, PARR, BR, BC) and Booking.com (B.XML `roomrates`/`promotions`, OTA
   `HotelAvailNotif`/`HotelRateAmountNotif`/`HotelResNotif`/`HotelResModifyNotif`) formats.
   Certification validates every message against the OTA's test properties, so expect to adjust details
   there. The promotions payloads are the most likely to need changes.
3. Have each hotel select this PMS as its connectivity provider in Expedia Partner Central / the
   Booking.com Extranet, then onboard it here in live mode.

Current limitations: one OTA rate plan per PMS room type, per-room (not per-occupancy) pricing, no
import of guest card details, promotions only on Expedia, Booking.com and Google, and no Airbnb sign-in button yet
(the host's OAuth token is pasted in the wizard).
