# Running HotelOne on Cloudflare

HotelOne runs on Cloudflare Workers through the OpenNext adapter
(`@opennextjs/cloudflare`). The same code still deploys to Vercel, so both
hosts can run side by side on the same Neon database until Vercel is retired.

| Piece | On Vercel | On Cloudflare |
|---|---|---|
| App | Vercel project, `scripts/vercel-build.mjs` | Worker built by `npm run cf:build`, config in `wrangler.jsonc`, entry `worker.ts` |
| Migrations | inside the Vercel build | `.github/workflows/deploy-cloudflare.yml`, before the deploy |
| Database | Prisma's engine, one shared client | Prisma `pg` driver adapter, one client per request (`src/lib/prisma.ts`), optionally through Hyperdrive |
| Cron | `vercel.json` crons | Cron Triggers in `wrangler.jsonc`, handled by `scheduled()` in `worker.ts` |
| Photos | Vercel Blob | R2 bucket `hotelone-media` (binding `MEDIA`), public at `MEDIA_PUBLIC_URL` |
| Hotel domains | Vercel Domains API | Cloudflare for SaaS custom hostnames (`CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ZONE_ID`) |
| Client IP | `x-vercel-forwarded-for` | `CF-Connecting-IP` (when `HOSTING=cloudflare`) |
| Env name / release | `VERCEL_ENV`, `VERCEL_GIT_COMMIT_SHA` | `APP_ENV`, `GIT_SHA` |

Two Workers: `hotelone-staging` (top level of `wrangler.jsonc`, on
`*.workers.dev`) and `hotelone` (`env.production`, which gets the
`hotelone.site` routes at cutover).

## Local

```bash
cp .env.example .dev.vars        # then fill in DATABASE_URL, NEXTAUTH_SECRET, …
npm run cf:preview               # builds and serves the Worker on http://localhost:8787
```

`.dev.vars` is git-ignored. Cron runs locally with
`npx wrangler dev --test-scheduled` and `curl "localhost:8787/__scheduled?cron=0+10+*+*+*"`.

## One-time setup

1. **Account and token.** Workers Paid plan (the bundle is about 8 MB
   compressed; the free plan allows 3 MB). An API token with Account: Workers
   Scripts, Workers R2 Storage, Hyperdrive (Edit), Account Settings (Read);
   Zone: DNS, SSL and Certificates, Workers Routes (Edit). In GitHub →
   Settings → Secrets → Actions: `CLOUDFLARE_API_TOKEN`,
   `CLOUDFLARE_ACCOUNT_ID`, `DATABASE_URL` (production Neon URL) and,
   optionally, `STAGING_DATABASE_URL` (a Neon branch).

2. **Buckets.**
   ```bash
   npx wrangler r2 bucket create hotelone-media-staging
   npx wrangler r2 bucket create hotelone-media
   ```
   Give `hotelone-media` the public custom domain `media.hotelone.site`
   (R2 → bucket → Settings → Custom Domains) once the zone is on Cloudflare;
   until then use the bucket's `r2.dev` address for staging
   (`STAGING_MEDIA_PUBLIC_URL` repository variable and the `MEDIA_PUBLIC_URL` secret).

3. **Secrets.** Copy the Vercel variables exactly (the vault key above all):
   ```bash
   npx vercel env pull .env.vercel --environment=production
   node scripts/cloudflare-secrets.mjs .env.vercel             # staging
   node scripts/cloudflare-secrets.mjs .env.vercel production  # production
   rm .env.vercel
   ```
   For staging also set `NEXTAUTH_URL`, `NEXT_PUBLIC_SITE_URL` and
   `HOTELONE_PUBLIC_URL` to the staging address
   (`npx wrangler secret put NEXTAUTH_URL`), and point `DATABASE_URL` at the
   staging Neon branch, not production. Keep `ELEVENLABS_NAMESPACE` unset on
   staging so its phone agents don't overwrite production's.

4. **Photos.** With uploads switched to R2 (production deploy with
   `MEDIA_PUBLIC_URL` set), copy the existing Blob photos and rewrite their
   URLs:
   ```bash
   BLOB_READ_WRITE_TOKEN=… CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… \
   R2_BUCKET=hotelone-media MEDIA_PUBLIC_URL=https://media.hotelone.site \
   DATABASE_URL=… node scripts/copy-blob-to-r2.mjs           # dry run
   … node scripts/copy-blob-to-r2.mjs --apply
   ```
   Blob stays as it was, so Vercel keeps showing photos during the overlap.

5. **Hyperdrive (recommended).**
   `npx wrangler hyperdrive create hotelone-db --connection-string="<Neon direct URL>"`,
   then uncomment the `hyperdrive` lines in `wrangler.jsonc` with its id.

6. **Deploy.** GitHub → Actions → *Deploy to Cloudflare* → Run workflow
   (staging or production). Set the repository variable
   `CLOUDFLARE_AUTO_DEPLOY=true` to deploy staging on every push to `main`,
   and `CLOUDFLARE_AUTO_DEPLOY_ENV=production` after cutover.

## DNS cutover (production, needs the owner's go-ahead)

7. Add `hotelone.site` to Cloudflare (it imports the GoDaddy records; check
   every one, including Resend's mail records), lower the TTLs at GoDaddy a
   day ahead, then change the nameservers at GoDaddy to the two Cloudflare
   gives. The registration stays at GoDaddy.
8. Uncomment `routes` under `env.production` in `wrangler.jsonc` and deploy
   production. Enable SSL/TLS → Custom Hostnames (Cloudflare for SaaS), add
   a proxied DNS record `hotels` (e.g. `AAAA 100::`) and set
   `hotels.hotelone.site` as the fallback origin. Set the Worker secrets
   `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ZONE_ID`, then re-add each hotel's
   own domain (Setup → Booking domain → Check) so it becomes a custom
   hostname, and send those owners the new CNAME target
   `hotels.hotelone.site`.
9. Checks: Google sign-in (redirect `https://hotelone.site/api/auth/callback/google`
   is unchanged), a Stripe test webhook, *Refresh* on each hotel's Phone tab,
   a PMS connector run, a channel cron run (Worker logs), a photo upload.

**Rollback:** in Cloudflare DNS point `hotelone.site` and `www` back at
Vercel (`A 76.76.21.21`, `CNAME cname.vercel-dns.com`) and remove the Worker
routes. Vercel runs on the same database the whole time.

## Things to verify on staging

- **PMS URL guard** (`src/server/pms/url-guard.ts`) uses `dns.lookup` and a
  custom `lookup` for `http.request`; under `nodejs_compat` these may behave
  differently. Connect a test PMS before cutover.
- **Long `after()` work** (PMS runs, channel sync, skills) gets about 30
  seconds after the response on Workers. Anything longer needs a Queue.
- **Sentry server errors** arrive through `@sentry/nextjs` under workerd;
  confirm one test error shows up, else add `@sentry/cloudflare`.
- **Root hotel domains** (`mymotel.com`, not `book.mymotel.com`) need a DNS
  provider with CNAME flattening, since Cloudflare for SaaS gives no fixed
  apex IP below Enterprise.

## Retiring Vercel (a week after cutover)

Delete `vercel.json`, `scripts/vercel-build.mjs` and the Vercel-only code
paths (`@vercel/blob`, the Vercel half of `src/server/domains.ts`), the Blob
store and the Vercel project.
