# OTA partner access: what to apply for

Every OTA connection in HotelOne works in **sandbox mode** now. To take real bookings, the business running HotelOne
needs partner access. This list says what to apply for and what to set once it's granted. The technical details are in
[CHANNEL_MANAGER.md](CHANNEL_MANAGER.md).

## Fastest route: Channex (covers six OTAs)

Channex (channex.io) sells a white-label channel manager API to PMS companies and is already certified with
Booking.com, Expedia, Airbnb, Agoda, Trip.com and Hostelworld.

- [ ] Sign up for the Channex WhiteLabel plan (listed at $130/month plus $7 per hotel, no commission). Use their staging account first.
- [ ] For each hotel: create the property and its room types and rate plans in Channex, then connect and map the OTA inside Channex.
- [ ] In HotelOne: Channels > Connect > Live > "Connect through Channex", with the Channex property ID and an API key scoped to it.
- [ ] To test against staging, set `CHANNEX_API_BASE_URL=https://staging.channex.io/api/v1`.

## Direct, per OTA

| OTA | Apply for | Once approved, set | Status of HotelOne's adapter |
| --- | --- | --- | --- |
| **Google Hotels** | Hotel Center account approved as an integration partner for free booking links | Partner key per hotel in the wizard. Allowlist the sending IPs in Hotel Center (needs Vercel Static IPs or a fixed-IP proxy). Upload the Point of Sale file from `/api/channels/google/point-of-sale` | Built from Google's published ARI spec. Not via Channex |
| **Airbnb** | Airbnb Software Partner program. Invite-only, so Channex is the realistic route | `AIRBNB_API_KEY`; host OAuth token per hotel; webhook URL in the Airbnb partner dashboard | Airbnb's API isn't public. Field names need checking during certification |
| **Agoda** | Agoda connectivity partner (developer.agoda.com/supply) | Supply API username and password per hotel; webhook URL as the booking push endpoint | Built from Agoda's published OTA API (2015B) |
| **Trip.com** | Trip.com Group connectivity partner, through your Trip.com market manager | `TRIP_COM_OTA_URL`; requestor ID and message password per hotel; webhook URL | Standard OTA messages. Spec not public, so expect adjustments |
| **Hopper** | Hopper direct supply partnership (it onboards hotels through channel managers such as Cloudbeds) | `HOPPER_OTA_URL`; credentials per hotel; webhook URL | No public spec. Placeholder OTA messages until Hopper shares its spec. Not via Channex |
| **Priceline** | Priceline connectivity partner. Separate from Booking.com even though both belong to Booking Holdings | `PRICELINE_OTA_URL`; credentials per hotel; webhook URL | No public spec. Placeholder OTA messages until Priceline shares its spec. Not via Channex |
| **Hostelworld** | Hostelworld connectivity partner (or Channex) | `HOSTELWORLD_OTA_URL`; credentials per hotel; webhook URL | Spec not public. Channex is the simpler route |
| Expedia / Booking.com | Expedia Group and Booking.com connectivity programs, or Channex | as before | Built from the published specs |

## For every live connection

- [ ] `HOTELONE_VAULT_KEY` is set in production. It seals OTA passwords and derives the webhook URLs.
- [ ] `CRON_SECRET` is set, and the reservation pull runs every 5 minutes for pulled channels (Expedia, Booking.com, Channex).
- [ ] The hotel uses the `FULL` setup path (it takes its bookings in HotelOne).
