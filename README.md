# HotelOne

Direct booking, an agentic front desk and a voice front desk for independent hotels — with a path for every hotel. Live at [hotelone.site](https://hotelone.site).

| Path | For hotels that… | They get |
| --- | --- | --- |
| **Run on HotelOne** (`FULL`) | want one system | White-label booking site, front desk, housekeeping, rates, analytics, the agent and voice |
| **Keep your PMS** (`BRIDGE`) | aren't ready to migrate (or never will) | The agent and voice working *their* PMS through the bridge — desktop connector or cloud browser |
| **Just voice** (`VOICE`) | want to stop missing calls first | A phone line answered with their own prices and policies; booking requests and messages go to an inbox and to their email |

Hotels move between paths without starting over (Console → *Your PMS* → *Move to HotelOne*).

## What's inside

- **Guest journey** — directory with live "from" prices, white-label hotel pages (brand colour, photo mosaic, live room prices and scarcity), stepped checkout with inline sign-up, pay-at-hotel or Stripe, a booking page with free date changes / cancellation until 3 PM the day before, add-to-calendar, and *My trips*.
- **Staff console** (`/admin`) — two ways to work the same data:
  - **Classic**: dashboard with setup checklist and forecast, front desk (arrivals, departures, in-house, room board), housekeeping (supervisor board + phone-first *My rooms*), reservations, rate calendar (drag-select, set/adjust/reset), analytics, rooms, properties, team, activity log, settings.
  - **Agentic**: a natural-language workspace whose answers render as live UI blocks (booking lists, room options, rate grids, plans). Every change is a **signed plan** (HMAC, 10-minute expiry, single use) that a person confirms; every action is permission-checked and audited. ⌘K opens the agent from any Classic screen, and alerts hand off to it ("Fix").
- **Voice front desk** — ElevenLabs Agents (WebSocket, HotelOne provisions and syncs the agents) or OpenAI GPT-Live (`gpt-live-1`, WebRTC with Responses delegation). Guests talk through one persistent voice overlay that follows them across the site (hotel page → checkout → booking page) without dropping the call; staff go hands-free in the agent workspace. Either way, tool calls are executed by HotelOne code, never by the model directly.
  - On a hotel's pages it is that hotel's front desk ("Talk to us"); everywhere else it is the **HotelOne concierge** ("Ask HotelOne"): the guest says a place, dates and party size, and it searches every listed hotel, opens one, opens checkout and books pay-at-hotel only after the guest's clear yes. Pages tell it what's on screen with `useVoicePage(...)` (`src/components/voice/page-context.tsx`).
- **Voice-only hotels** — they keep bookings in their own system, so HotelOne never claims a room is free or sold out: the voice quotes their prices, tells callers *their* check-in/out times and cancellation policy (Voice → Settings), and turns bookings into requests the team confirms in their own system. They aren't listed in the public directory and can't be booked online. Onboarding asks only for rooms and prices, times and policy, and an optional transfer number; the phone line is on from the start.
- **AI assistants** — people's own assistants (Claude, ChatGPT, Grok, Le Chat, any MCP client) search and book through an MCP server (`/api/mcp`, or one hotel at `/api/mcp/hotels/{id}`), a REST API (`/api/agents/v1`, described at `/openapi.json`), `/llms.txt` and `/.well-known/agent-card.json`. Without a key they get prefilled checkout links and booking requests; hotels can issue API keys (*Setup → AI assistants*) that let a trusted partner book directly (pay at hotel). Guide for guests: `/assistants`.
- **Skills** — every agent's reusable tools (`src/server/skills`): answers generated from each hotel's settings (FAQs, amenities, policies, rooms, contact) and kept in sync, staff-agent shortcuts ("save that as a shortcut called late checkout", then "late checkout for Smith" — changes still need a confirmed plan), shortcuts suggested from repeated commands, and PMS-bridge recipes learned from tasks that worked. Managed on *Setup → Skills*.
- **Phone line** (ElevenLabs) — each hotel gets its own phone agent; connect a Twilio number from the console (*Voice → Phone → Connect a number*: Twilio confirms the credentials own the number, ElevenLabs imports it and points it at the hotel's agent; nothing is stored), or point a SIP-trunk or Exotel number at it in ElevenLabs, and forward the hotel's existing number to it. Assign the same agent to a WhatsApp number in ElevenLabs and it answers WhatsApp chats and calls too. Calls start with a webhook to HotelOne (hotel prompt + signed session) and run their tools server to server; phone bookings become requests the team confirms (hotels on HotelOne send the guest a pre-filled booking link; voice-only hotels book it in their own system). Every new message or booking request is emailed to the hotel (Voice → Settings → *Email them to*; the owners by default). See *Voice → Phone* in the console.
- **PMS bridge** — a computer-use operator that works the hotel's existing PMS in a browser, through the HotelOne Connector on a hotel computer or our isolated cloud browser — or, when the PMS company offers one, **their MCP server**: HotelOne connects and tests it, caches its tools as skills, runs look-ups through read-only tools and changes only after a confirmed plan, and accepts signed events back. Partner guide and tool contract: `/developers/pms` (`src/server/pms`).
- **The agent on WhatsApp, always on** — owners, managers and front desk link their phone (*Account → Security*) and use the same agent from WhatsApp: look-ups answer at once, changes come back as a plan that runs when they reply YES. The agent also watches each hotel and messages the right people when something needs them (overdue check-outs, arrivals without a room, rooms not ready, guest messages, card disputes, PMS or OTA problems, an 8am brief), with the fix as a one-number reply. Owners choose per hotel what each role may do through the agent and which alerts it gets (*Setup → Agent access*). Meta setup in [WHATSAPP.md](WHATSAPP.md) (`src/server/whatsapp`, `src/server/agent/policy.ts`, `watch.ts`).
- **AI business advisor** (`/admin/advisor`, owners and admins) — a Claude chat that sees the whole portfolio: each turn starts from a fresh snapshot (every property and room type, occupancy, ADR, RevPAR and revenue vs last year, the next 30/90 days on the books vs the same time last year, 13-month trends, operations), and read-only tools drill into any date range, booking pace, demand patterns, the rate calendar against occupancy, and individual bookings. Guests are anonymised; no names, contact or payment details reach the model. Needs `ANTHROPIC_API_KEY`; conversations stay in the browser (`src/lib/business-agent`).
- **Channels** — Expedia and Booking.com for hotels on HotelOne: onboarding (sandbox or live), room mapping, rate/availability/restriction sync after every booking and rate change, OTA reservations imported as bookings, promotions, and a Channel Agent that changes OTA rates and promotions from plain-English requests with approval. See [CHANNEL_MANAGER.md](CHANNEL_MANAGER.md) (`src/server/channels`).
- **Cardholder authorization** — when someone else pays (online or at the desk, there or not), staff send the cardholder a one-time link (email, text, QR code or the desk's device). They enter the card's last four digits (checked against the card that paid), their photo ID with a photo, and a drawn or typed signature; staff verify the ID, and the signed record goes into dispute evidence. Card numbers are never collected; ID photos are encrypted and deleted after a retention period. See [PAYMENTS.md](PAYMENTS.md) (`src/server/payments/cardAuthorization.ts`).
- **Booking confirmation email** (Resend) — sent by HotelOne on the hotel's behalf (`src/server/email.ts`).
- **Front desk: New reservation and Night audit** — staff take walk-in and phone bookings from the front desk (same booking engine and prices as the website, confirmed at once, optionally checked straight in; `src/server/services/reservations.ts`). The night audit closes the business day: arrivals who never came become no-shows, overdue departures and unpaid balances are listed, occupied rooms can be flagged for stayover cleaning, and the day's report (occupancy, room revenue, ADR) is saved once per day (`src/server/services/nightAudit.ts`).
- **Each hotel's clock, currency, taxes and fees** — a hotel's "today", check-in day and 3 PM cancellation cut-off follow its own time zone; prices, Stripe charges, emails and the agent use its currency; taxes and fees (a percentage, per room per night, per guest per night or per stay) are added to every quote and shown line by line at checkout. Bookings store their currency, room subtotal and charge lines; reports count room revenue without taxes (*Settings → Prices and time*, `src/server/services/hotels.ts`, `pricing.ts`).
- **Hotel groups (organizations)** — administrators of an organization see and manage every hotel in it; its sign-in policy covers its staff (*Setup → Organization*, `src/server/services/organizations.ts`).
- **Sign-in security** — lockouts after repeated failures and sign-up limits per network, password reset by email, email verification, a 10-character password rule, two-step sign-in (TOTP with recovery codes; organizations can require it), "sign out everywhere", OpenID Connect single sign-on per organization with people created on first sign-in, and SCIM 2.0 provisioning (`/api/scim/v2`). Password changes, two-step changes, deactivation and role changes end existing sessions (`src/server/auth`, *Account → Security*).
- **Error tracking and logs** — structured JSON logs in production and Sentry when `SENTRY_DSN` is set, including background work and uncaught route errors (`src/server/log.ts`, `src/instrumentation.ts`).

## Architecture

```
src/app            Next.js App Router pages + route handlers (thin)
src/server         Domain layer (server-only)
  authz.ts         roles → permissions, per-property tenancy scoping (plus organization admins' hotels)
  auth/            sign-in (lockouts, two-step codes), tokens, password reset, email
                   verification, TOTP, OIDC single sign-on, SCIM provisioning
  log.ts           structured logs + Sentry
  services/        bookings, inventory (availability + pricing), pricing (taxes and fees),
                   hotels (each hotel's clock and currency), rates, rooms, housekeeping,
                   front desk, reservations (at the desk), night audit, organizations,
                   guest self-service, bridge, audit
  agent/           deterministic NLU → resolver → read tools / write planners,
                   signed plans, NDJSON streaming engine (llm.ts = optional plug-in),
                   agent access per hotel and role (policy.ts), the always-on rounds (watch.ts)
  whatsapp/        the agent on WhatsApp: Cloud API, phone linking, chat, block rendering
  voice/           GPT-Live session creation, prompts, tool schemas, guest tools
  bridge/          computer-use operator step + TOTP
  vault.ts         AES-256-GCM sealing for stored PMS logins
src/components     console shell, agent UI + blocks, voice UI, guest UI, design system
public/downloads   hotelone-connector.mjs (desktop connector / cloud worker);
                   stayos-connector.mjs stays for computers set up before the rename
connector/         connector docs
prisma/            schema, migrations, demo seed
tests/unit         Vitest: pricing, currency, clocks, TOTP, signed plans, SSO state, SCIM filters, authz, WhatsApp, agent access
tests/integration  Vitest + PostgreSQL: booking engine, desk reservations, night audit, sign-in, reset, organizations, SCIM,
                   the agent on WhatsApp and its alerts
```

Key rules the code enforces:

- **Availability is derived from bookings** for every night (no counters to drift); prices come from the rate calendar's exceptions over the base price, and the booking endpoint charges exactly the quote. Booking creation runs in a serializable transaction.
- **Dates are calendar days** (`YYYY-MM-DD`, stored at 12:00 UTC); each hotel's "today" uses its own time zone (`HOTEL_TIMEZONE` for hotels that haven't set one).
- **Money is in the hotel's currency**, rounded to that currency's minor unit; the booking stores exactly what Stripe charges (taxes and fees included).
- **Nothing changes without a person**: agent writes → signed plan → confirm (a YES on WhatsApp); voice writes → spoken yes → the same plan; bridge changes → confirmed plan → queued task; look-ups only are read-only by design. The always-on agent only tells people things; its suggested fixes go through the same plan.
- **Secrets stay server-side**: OpenAI keys never reach browsers or connectors; PMS passwords are sealed and typed by the worker when the model calls `fill_credential` — the model never sees them.

## Getting started

Requirements: Node 20+, PostgreSQL.

```bash
npm install
cp .env.example .env.local      # fill in DATABASE_URL and NEXTAUTH_SECRET at minimum
npx prisma migrate deploy
npm run db:seed                 # demo data (wipes the dev database)
npm run dev
```

Open http://localhost:3000 and use the one-click demo logins on `/demo`, the *Live demo* page (password `demo1234`):

| Login | Sees |
| --- | --- |
| `owner@hotelone.demo` | Everything, plus **Harbor Motel** (a bridge-path hotel on Cloudbeds) |
| `manager@hotelone.demo` | Operations, rates, team |
| `frontdesk@hotelone.demo` | Front desk, reservations, the agent |
| `housekeeping@hotelone.demo` | *My rooms* (phone-first) |
| `guest@hotelone.demo` | Trips and the booking flow |

`.demo` addresses never resolve, so no real email is sent to them. Databases seeded before the rename had `@stayos.demo` logins; a migration moves them to `@hotelone.demo`, and the old domain is still treated as a demo login.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | ✓ | PostgreSQL connection string (on Vercel, `POSTGRES_PRISMA_URL` / `POSTGRES_URL` also work) |
| `DIRECT_URL` | ✓ local | Unpooled connection for migrations (locally the same as `DATABASE_URL`; the Vercel build fills it from `DATABASE_URL_UNPOOLED` / `POSTGRES_URL_NON_POOLING` / `DATABASE_URL`) |
| `NEXTAUTH_SECRET` | ✓ | Session signing; also signs agent plans and voice sessions unless `AGENT_PLAN_SECRET` is set |
| `NEXTAUTH_URL` | prod | Public URL (Stripe return URLs) |
| `HOTEL_TIMEZONE` | | Platform default time zone (default `America/Los_Angeles`); each hotel can set its own |
| `AGENT_PLAN_SECRET` | | Separate secret for signed agent plans |
| `NEXT_PUBLIC_DEMO_MODE` | | `true` = public demo: one-click demo logins on `/demo` (the *Live demo* page); the shared demo logins and the demo hotels' public details (name, listing, voice script) can't be changed |
| `NEXT_PUBLIC_SITE_URL` | | Canonical public address, e.g. `https://hotelone.site` — metadata, sitemap, and Stripe return URLs (default: `https://hotelone.site` for metadata, the host the guest booked on for Stripe) |
| `ELEVENLABS_API_KEY` | voice | Voice front desk on ElevenLabs Agents (used when set). Needs Agents write access; HotelOne creates and updates its two agents itself |
| `ELEVENLABS_VOICE_ID`, `ELEVENLABS_LLM` | | ElevenLabs voice (default: the platform default) and LLM (default `gemini-2.5-flash`) |
| `HOTELONE_PUBLIC_URL` | | Public https address for phone-line webhooks and booking links (default: `NEXT_PUBLIC_SITE_URL`, else the Vercel production domain). `STAYOS_PUBLIC_URL` is still accepted |
| `VOICE_PHONE_MAX_CALLS_PER_HOTEL_HOUR`, `VOICE_PHONE_MAX_CALLS_PER_HOUR` | | Phone-call ceilings per hotel and across hotels (defaults 120 / 300), separate from the booking page's |
| `ELEVENLABS_PHONE_AUDIO_FORMAT` | | Phone agent audio (default `ulaw_8000`, right for Twilio and SIP/PCMU; `auto` leaves it to ElevenLabs) |
| `ELEVENLABS_GUEST_AGENT_ID`, `ELEVENLABS_STAFF_AGENT_ID` | | Use your own ElevenLabs agents instead (they need the same client tools, and the System prompt and First message overrides switched on under Security) |
| `VOICE_PROVIDER` | | `elevenlabs` or `openai` to force a provider |
| `OPENAI_API_KEY` | voice / bridge | Voice front desk on GPT-Live (when ElevenLabs isn't set), and the bridge operator |
| `OPENAI_LIVE_MODEL` | | Voice model (default `gpt-live-1`) |
| `OPENAI_VOICE_BACKEND_MODEL` | | Model the voice delegates reasoning/tools to (default `gpt-6-luna`) |
| `BRIDGE_OPERATOR_MODEL` | | Computer-use model (default `computer-use-preview`) |
| `BRIDGE_OPERATOR_TOOL` | | `computer` to use the GA computer tool instead of `computer_use_preview` |
| `HOTELONE_VAULT_KEY` | prod | 32-byte base64 key for sealing PMS logins, two-step sign-in secrets and SSO client secrets (`openssl rand -base64 32`); dev derives one from `NEXTAUTH_SECRET`. `STAYOS_VAULT_KEY` is still accepted — to switch names, copy the **exact same value** (a new key can't open stored logins) |
| `BRIDGE_WORKER_SECRET` | cloud bridge | Shared secret for the cloud worker (`hotelone-connector.mjs worker`) |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | | Online card payment (pay-at-hotel works without) |
| `RESEND_API_KEY` | | Confirmation emails |
| `CARD_AUTH_ID_PHOTO_DAYS` | | Days after check-out a card authorization's ID photo is kept, unless a dispute is open (default 180) |
| `EMAIL_FROM` | | Sender for confirmation emails (default `HotelOne <bookings@hotelone.site>`, which needs hotelone.site verified in Resend) |
| `BLOB_READ_WRITE_TOKEN` | | Photo uploads (Vercel Blob) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | | Google sign-in for guests |
| `ADMIN_SEED_PASSWORD`, `DEMO_PASSWORD`, `SEED_DEMO`, `ALLOW_SEED_WIPE` | | Seeding controls (production and Vercel builds never wipe unless `ALLOW_SEED_WIPE=true`; the demo is created once) |
| `SKIP_MIGRATIONS` | | `true` stops the Vercel build from running `prisma migrate deploy` |
| `VOICE_CONCIERGE` | | `off` turns off the all-hotels voice concierge (on whenever voice is on) |
| `VOICE_CONCIERGE_MAX_SESSIONS_PER_HOUR`, `VOICE_CONCIERGE_VOICE` | | Hourly ceiling for concierge web calls (default 120) and its GPT-Live voice (default `marin`) |
| `AGENT_API_ALLOWED_ORIGINS` | | Comma-separated browser origins allowed to call `/api/mcp` and `/api/agents/v1` (empty: any https origin; server-to-server calls need none) |
| `AGENT_API_READS_PER_MINUTE`, `AGENT_API_REQUESTS_PER_HOUR`, `AGENT_API_LOOKUPS_PER_HOUR` | | Per-IP limits for AI assistants without a key (defaults 120 / 10 / 20); raise them if hosted assistants that share IP addresses hit them |
| `AGENT_KEYS_PER_HOTEL_DAY` | | API keys a hotel can create per day, revoked ones included (default 10) |
| `AGENT_API_KEY_HOTEL_LOOKUPS_PER_HOUR`, `AGENT_API_KEY_HOTEL_REQUESTS_PER_HOUR`, `AGENT_API_KEY_HOTEL_BOOKINGS_PER_HOUR` | | Pools shared by all of a hotel's keys, on top of each key's own limits (defaults 300 / 100 / 100) |
| `CONCIERGE_MAX_REQUESTS_PER_HOTEL_HOUR`, `CONCIERGE_MAX_PUBLIC_REQUESTS_PER_HOTEL_HOUR` | | Booking requests per hotel per hour from key holders and from anonymous assistants (defaults 20 / 10) |
| `AGENT_CONFIRMATIONS_PER_HOTEL_DAY`, `AGENT_CONFIRMATIONS_PER_KEY_DAY` | | Confirmation emails for API-key bookings per hotel and per key per day (defaults 50 / 25; each address also gets at most 3 a day) |
| `TRUSTED_PROXY_HOPS` | | Off Vercel: which X-Forwarded-For entry (counting from the right) is the client for rate limits (default 1). On Vercel its own headers are used |
| `PMS_MCP_MODEL` | | Model that plans PMS MCP tool calls when the vendor doesn't follow the HotelOne contract (default `OPENAI_VOICE_BACKEND_MODEL`) |
| `PMS_MCP_ALLOWED_HOSTS` | | Hosts a PMS MCP server may use despite the private-address guard (e.g. a vendor's on-premise gateway) |
| `CRON_SECRET` | channels / alerts | Bearer token for `/api/channels/cron` (OTA reservation import + daily reconciliation; Vercel Cron sends it) and `/api/cron/agent-watch` (the always-on agent's rounds) |
| `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` | WhatsApp | The staff agent on WhatsApp (Meta Cloud API); off until all four are set. Optional `WHATSAPP_DISPLAY_NUMBER`, `WHATSAPP_ALERT_TEMPLATE`, `WHATSAPP_ALERT_TEMPLATE_LANG`, `WHATSAPP_GRAPH_VERSION`. See [WHATSAPP.md](WHATSAPP.md) |
| `CHANNEL_AGENT_MODEL` | | Channel Agent model (default `OPENAI_VOICE_BACKEND_MODEL`); the agent needs `OPENAI_API_KEY` |
| `EXPEDIA_EQC_BASE_URL`, `EXPEDIA_API_BASE_URL`, `BOOKING_COM_SUPPLY_URL`, `BOOKING_COM_SECURE_URL` | | Point live OTA connections at a certification environment (see CHANNEL_MANAGER.md) |
| `PMS_EVENTS_SECRET` | | Base secret for PMS event signatures (default: derived from `NEXTAUTH_SECRET`, so rotating that rotates every PMS event secret) |
| `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` | | Error tracking on the server and in browsers (off when unset; the browser only downloads Sentry when set). `SENTRY_ENVIRONMENT`, `SENTRY_TRACES_SAMPLE_RATE` tune it |
| `SIGNUP_MAX_PER_IP_HOUR` | | New guest accounts per network per hour (default 10) |
| `TEST_DATABASE_URL` | tests | PostgreSQL for `npm run test:integration` (migrations are applied; nothing is deleted) |
| `VOICE_MAX_SESSIONS_PER_HOUR`, `BRIDGE_MAX_TASKS_PER_HOUR`, `ONBOARDING_MAX_PER_HOUR` | | Spend and abuse ceilings, enforced in the database so they hold across server instances (defaults 300 / 30 per hotel / 30) |

## The PMS bridge in one minute

1. Owner opens **Your PMS**, picks their system and how to reach it.
2. **Desktop**: download `hotelone-connector.mjs`, pair with the one-time code, run it, sign in to the PMS in its window. **Cloud**: store a (preferably dedicated) PMS login — sealed, write-only — and run the worker.
3. Staff ask the agent ("who's arriving?", "check in Moreno into 14"). Look-ups queue straight away; changes need a confirmed plan. Results stream back into the conversation as live task cards.

See [`connector/README.md`](connector/README.md) for details and guardrails.

## Hotel groups, single sign-on and SCIM

1. An owner opens *Setup → Organization*, names the group and picks their hotels; they become its administrator and see every hotel in it.
2. *Sign-in policy*: require two-step sign-in for staff who use a password, and choose the role new SSO/SCIM people get.
3. *Single sign-on*: create an OpenID Connect web app in your identity provider (Okta, Microsoft Entra ID, Google Workspace, Auth0, Keycloak) with the redirect URI `https://<your-domain>/api/sso/callback` and scopes `openid email profile`, then enter the issuer, client ID, client secret and your email domains. Staff click *Continue with single sign-on* on the login page. "Require it" turns off passwords for those domains. SAML-only providers connect through a broker that speaks OIDC.
4. *SCIM*: create a token and give your identity provider the base URL `https://<your-domain>/api/scim/v2`. It can create, update, deactivate and remove staff; removed people are turned off and keep their history.

## Tests and CI

```bash
npm test                                   # unit tests, no database
TEST_DATABASE_URL=postgresql://…/hotelone_test npm run test:integration
npm run typecheck && npm run lint
```

GitHub Actions (`.github/workflows/ci.yml`) runs lint, type check, unit tests, integration tests against PostgreSQL 16 and a production build on every pull request and every push to `main`.

## Deploying

Vercel: connect the repo, add a Postgres database from *Storage*, set the secrets, redeploy — migrations and the optional demo seed run during the build. Step by step, including the custom domain (hotelone.site), in [`DEPLOYMENT.md`](DEPLOYMENT.md); `/api/health` confirms the database is connected.

## Renamed from StayOS

The product name lives in `src/config/product.ts` (`PRODUCT_NAME`, `PRODUCT_DOMAIN`, …) — import it rather than writing the name. A few internal identifiers keep the old name on purpose, because they are stored outside this repo or in data that must keep working:

- Phone webhooks: the `X-StayOS-Webhook` header and the `stayos_session` / `stayos_tool` fields are configured in every hotel's ElevenLabs phone agent and tools.
- Vault key derivation (`stayos-vault`, `stayos-dev-secret`, used only without a vault key in development) opens logins already sealed.
- Browser storage keys (`stayos-theme`, `stayos:*`, `stayos.checklist.*`, `stayos-agent:*`), the calendar UID suffix `@stayos`, the connector's `~/.stayos` folder on existing installs, and the `STAYOS_*` environment variables (each has a `HOTELONE_*` name read first).

## Scripts

`npm run dev` · `npm run build` · `npm run lint` · `npm run typecheck` · `npm test` · `npm run test:integration` · `npm run db:seed` · `npx prisma migrate deploy`
