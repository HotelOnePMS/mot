# Deploying HotelOne on Vercel

The repo deploys as-is: `vercel.json` runs `scripts/vercel-build.mjs`, which

1. maps whatever connection-string names the Postgres integration injected (Neon: `DATABASE_URL` + `DATABASE_URL_UNPOOLED`; Supabase: `POSTGRES_PRISMA_URL` / `POSTGRES_URL_NON_POOLING`; Prisma Postgres: `DATABASE_URL` / `POSTGRES_URL`) onto the `DATABASE_URL` / `DIRECT_URL` Prisma reads;
2. with a database: runs `prisma migrate deploy`, then — when `SEED_DEMO=true` — creates the demo hotels once (the seed never wipes on Vercel and skips itself when the demo already exists);
3. without one: still builds, so the first deploy never blocks; `/api/health` reports `not_configured` until a database is connected;
4. `prisma generate` + `next build`.

## One-time setup

1. **Project** → create it from the GitHub repo (Settings → Git → Connect Git Repository). Framework, build and install commands come from `vercel.json`.
2. **Database** → project → *Storage* → *Create Database* → **Neon** (free tier is enough) → connect it to Production and Preview. That adds `DATABASE_URL` / `DATABASE_URL_UNPOOLED`.
3. **Environment variables** (Settings → Environment Variables):

   | Variable | Value |
   | --- | --- |
   | `NEXTAUTH_SECRET` | `openssl rand -base64 32` (sensitive) |
   | `AGENT_PLAN_SECRET` | `openssl rand -base64 32` (sensitive) |
   | `HOTELONE_VAULT_KEY` | `openssl rand -base64 32` (sensitive) — seals stored PMS logins; never rotate without re-entering them. A project that already has `STAYOS_VAULT_KEY` can keep it (still accepted); to switch names, give `HOTELONE_VAULT_KEY` the **exact same value** |
   | `NEXT_PUBLIC_DEMO_MODE` | `true` for a public demo (one-click logins on `/login`) |
   | `SEED_DEMO` | `true` to create the demo hotels on the first build with a database |
   | `HOTEL_TIMEZONE` | e.g. `America/Los_Angeles` |
   | `ELEVENLABS_API_KEY` | voice front desk on ElevenLabs (preferred when set); then Console → Voice → *Check connection* creates the agents |
   | `OPENAI_API_KEY` | voice on GPT-Live (when ElevenLabs isn't set) and the PMS bridge operator |
   | `STRIPE_*`, `RESEND_API_KEY`, `EMAIL_FROM`, `BLOB_READ_WRITE_TOKEN`, `GOOGLE_CLIENT_*` | optional — confirmation emails come from `HotelOne <bookings@hotelone.site>` unless `EMAIL_FROM` says otherwise, so verify that domain in Resend first |

   Leave `NEXTAUTH_URL` unset: auth trusts the request host, which keeps preview URLs working. `NEXT_PUBLIC_SITE_URL` and `HOTELONE_PUBLIC_URL` are covered under *Custom domain* below.
4. **Deploy** → *Deployments* → *Redeploy* (env and database changes only apply to new builds).
5. **Check** → `https://hotelone.site/api/health` (or the project's `*.vercel.app` address) should return `{"ok":true,"database":"up","seeded":true}`.

## Custom domain (hotelone.site)

1. **Vercel** → project → *Settings* → *Domains*: `hotelone.site` and `www.hotelone.site` are added. Keep one as the primary and let the other redirect to it (Vercel offers this when the domains are added).
2. **Registrar (GoDaddy)** → *My Products* → `hotelone.site` → *DNS*:

   | Type | Name | Value |
   | --- | --- | --- |
   | `A` | `@` | `76.76.21.21` |
   | `CNAME` | `www` | `cname.vercel-dns.com` |

   Remove the old `A` records for `@` (GoDaddy's parking/forwarding ones) and any other `www` record — leftovers send part of the traffic elsewhere. Vercel shows *Valid Configuration* and issues the HTTPS certificate once DNS has propagated (minutes, sometimes a few hours).
3. **Optional, then redeploy**: set `NEXT_PUBLIC_SITE_URL` and `HOTELONE_PUBLIC_URL` to `https://hotelone.site`. The first pins Stripe return URLs (and the canonical address for metadata and the sitemap); the second is the address phone-line webhooks and booking links use. Without them the app uses the Vercel production domain, which Vercel switches to the custom domain from the first deployment after the domain is added. `NEXT_PUBLIC_*` values are baked in at build time, so redeploy after changing them.
4. **Sign-in and payments**: if `NEXTAUTH_DOMAIN` is set, update it to `hotelone.site` or remove it (an old value breaks sign-in on the new address). With Google sign-in, add `https://hotelone.site/api/auth/callback/google` to the OAuth client's redirect URIs. With Stripe, point the webhook endpoint at `https://hotelone.site/api/webhooks/stripe`.
5. **Phone lines last**: ElevenLabs calls the public address, so finish DNS (*Valid Configuration* in Vercel) before turning on a phone line or opening the *Phone* tab. Lines that already exist keep calling the old address until their agent is re-synced: open each hotel's *Voice* → *Phone* tab as the owner, a manager or a platform admin (or press *Refresh* there) — that re-syncs the agent and its tools with the new webhook address; saving the line does the same. Until every line has been re-synced, keep the old `*.vercel.app` address publicly reachable — open `https://<project>.vercel.app/api/health` in a private window; if Vercel asks you to sign in, *Settings* → *Deployment Protection* is now covering it.
6. **PMS connectors**: desktop connectors remember the address they were paired with, so they keep using the old `*.vercel.app` address while it stays reachable; re-pair one to move it to `https://hotelone.site`. Set `HOTELONE_SERVER=https://hotelone.site` (or keep `STAYOS_SERVER`) on the cloud worker.

## Phone line (ElevenLabs)

Answer a hotel's phone with the voice front desk. Production only: preview deployments sit behind Vercel Authentication, which would refuse ElevenLabs' webhooks (the console says so on previews).

1. **Hotel in HotelOne** → the hotel's own property with its rooms and rates (that's what the voice quotes). In the public demo, demo hotels and the shared demo logins can't take a real line — sign up through *Get started*.
2. **Turn it on** → Console → *Voice* → *Phone* → **Turn on phone line** (owner or platform admin). HotelOne creates the hotel's phone agent in ElevenLabs, named `HotelOne — <hotel> phone · <ref>`; the Phone tab shows its agent ID. (Agents created before the rename keep their `StayOS — …` name until the next sync — opening the Phone tab renames the same agent in place; numbers stay assigned.)
3. **A number for the assistant** → most countries: a local Twilio number. India: an Indian provider such as Exotel — ask ElevenLabs about India data residency first. A hotel phone system with SIP: a SIP trunk.
4. **Point it at the agent** → a Twilio number: *Voice* → *Phone* → **Connect a number** (number, Account SID, Auth Token — Twilio confirms they own the number, then HotelOne imports it into ElevenLabs and assigns the hotel's agent; the credentials aren't stored). Platform admins can also pick any number already in the ElevenLabs account there. SIP trunk or Exotel: whoever runs the ElevenLabs account (never give hotel owners access to it, it holds every hotel's agents and calls) → ElevenLabs → *Agents* → *Phone numbers* → *Import number* → choose the agent whose ID the hotel's Phone tab shows.
5. **Keep the hotel's number** → forward calls to the new number. Most mobiles: `**61*<number>*11*20#` (no answer after 20 s) and `**67*<number>#` (busy); `##61#` / `##67#` undo them. US landlines: `*72<number>` forwards everything, `*73` stops. Codes vary by carrier; phone systems have "forward on no answer".
6. **Test** → *Voice → Phone → Refresh* lists the number once it points at the agent; then call the hotel number and let it ring through.

How it works: ElevenLabs calls `POST /api/voice/phone/start` when a call comes in. HotelOne answers with the hotel's prompt and greeting (which always says it's a virtual assistant) and a signed session token — or a polite "not available" when the line is paused, the voice is off in *Settings*, or limits are hit. Then ElevenLabs calls `POST /api/voice/phone/tool` for each lookup. Both carry an `X-StayOS-Webhook` header (the name predates the rename and stays — it's stored in every phone agent) derived from `AGENT_PLAN_SECRET` (or `NEXTAUTH_SECRET` when that isn't set): after rotating it, press *Refresh* on each hotel's Phone tab so its agent picks up the new value. Rotating `ELEVENLABS_API_KEY` within the same ElevenLabs account keeps every line working; moving to another account needs each number re-pointed.

- **Limits** (in the database, across all instances): 6 calls per caller per 10 minutes (withheld numbers share 12 per hotel), `VOICE_PHONE_MAX_CALLS_PER_HOTEL_HOUR` (default 120) per hotel and `VOICE_PHONE_MAX_CALLS_PER_HOUR` (default 300) across hotels — separate from the booking page's budgets. ElevenLabs' own per-agent caps (`ELEVENLABS_MAX_CONCURRENT`, `ELEVENLABS_MAX_DAILY`) apply per hotel. Calls end after 10 minutes or 45 seconds of silence.
- **Bookings by phone** arrive in *Messages* (and by email, when `RESEND_API_KEY` is set) with the quote. Hotels on HotelOne get a **Copy booking link** button to send the guest; voice-only hotels confirm it in their own system and call the guest back.
- **WhatsApp** (optional): in ElevenLabs → *Agents* → *WhatsApp* → *Import account*, sign in with the hotel's Meta business account and assign the hotel's agent. The same agent then answers WhatsApp messages — and WhatsApp calls once calling is enabled in WhatsApp Manager — with a WhatsApp-friendly prompt, the guest's WhatsApp number as their callback, and day-long sessions; bookings and messages arrive in *Messages* marked WhatsApp. A number can't be in the WhatsApp Business app and connected at once, so the easy setup is to put WhatsApp on the assistant's own number and leave the team's app on the hotel's number. Meta bills business-initiated messages and calls separately (payment method in WhatsApp Manager).
- **A person**: with *Put callers through to* set, the agent transfers callers who ask for one — use a direct line that doesn't forward back to the assistant. Without it, the agent takes a message.

## Notes

- Migrations run on every build that has a database (`prisma migrate deploy` only applies pending ones). Set `SKIP_MIGRATIONS=true` to opt out, e.g. for preview branches sharing the production database.
- Serverless-safe by design: plan single-use, voice and bridge budgets, and sign-up limits live in Postgres, so they hold across every function instance. Photo uploads are downscaled in the browser and sent one per request (Vercel caps request bodies at 4.5 MB).
- Public demo (`NEXT_PUBLIC_DEMO_MODE=true`): the shared `@hotelone.demo` logins (owner@, manager@, frontdesk@, housekeeping@, guest@ — password `demo1234`; older `@stayos.demo` ones count too) can't be re-passworded, deactivated or deleted, demo hotels keep their public details, and every deploy re-checks the demo logins. Sign-up forms tell visitors not to enter real details.
- Deployment Protection (Vercel Authentication) protects preview and per-deployment URLs by default; the production domain stays public.
- The cloud PMS bridge worker (`HOTELONE_SERVER=https://hotelone.site node hotelone-connector.mjs worker`) is a long-running process: run it on a small VM or container with `BRIDGE_WORKER_SECRET` set on both sides — not on Vercel Functions. `stayos-connector.mjs` and `STAYOS_SERVER` still work for existing installs.
- Renamed from StayOS: the `STAYOS_*` environment variables still work (each `HOTELONE_*` name is read first), so nothing has to change in Vercel for the rename itself. The ElevenLabs agents get their `HotelOne — …` names on their next sync (guest and staff agents on the next conversation or *Check connection*; phone agents when their *Phone* tab is opened) — the same agents, renamed in place.
