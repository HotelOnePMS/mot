#!/usr/bin/env node
/**
 * Copies environment variables from a .env file (for example one pulled from
 * Vercel) into the Cloudflare Worker as secrets, in one `wrangler secret bulk`
 * call. Values are never printed. See CLOUDFLARE.md, step 3.
 *
 *   npx vercel env pull .env.vercel --environment=production
 *   node scripts/cloudflare-secrets.mjs .env.vercel            # staging Worker
 *   node scripts/cloudflare-secrets.mjs .env.vercel production # production Worker
 *   rm .env.vercel
 *
 * Skipped: Vercel's own variables (VERCEL_*, BLOB_READ_WRITE_TOKEN), the
 * NEXT_PUBLIC_* ones (baked in at build time from GitHub variables) and
 * anything wrangler.jsonc already sets as a plain var for that environment.
 * HOTELONE_VAULT_KEY is copied byte for byte: a different value would make
 * every stored PMS login and two-step sign-in secret unreadable.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [file, target = 'staging'] = process.argv.slice(2);
if (!file) {
  console.error('Usage: node scripts/cloudflare-secrets.mjs <.env file> [staging|production]');
  process.exit(1);
}

function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      const quote = value[0];
      value = value.slice(1, -1);
      if (quote === '"') value = value.replace(/\\n/g, '\n').replace(/\\"/g, '"');
    }
    out[match[1]] = value;
  }
  return out;
}

// Plain vars already in wrangler.jsonc (kept in step by hand; small list).
const WRANGLER_VARS = {
  staging: ['HOSTING', 'APP_ENV', 'NEXT_PUBLIC_APP_ENV'],
  production: [
    'HOSTING', 'APP_ENV', 'NEXT_PUBLIC_APP_ENV', 'NEXT_PUBLIC_SITE_URL', 'HOTELONE_PUBLIC_URL', 'NEXTAUTH_URL',
    'PROPERTY_DOMAIN_BASE', 'MEDIA_PUBLIC_URL', 'CUSTOM_DOMAIN_CNAME_TARGET',
  ],
};

const skip = (key) =>
  key.startsWith('VERCEL') ||
  key.startsWith('NEXT_PUBLIC_') ||
  key.startsWith('TURBO_') ||
  key === 'NX_DAEMON' ||
  key === 'BLOB_READ_WRITE_TOKEN' ||
  (WRANGLER_VARS[target] ?? []).includes(key);

const all = parseEnv(readFileSync(file, 'utf8'));
const secrets = Object.fromEntries(Object.entries(all).filter(([key, value]) => value !== '' && !skip(key)));
if (!Object.keys(secrets).length) {
  console.error('No variables to copy.');
  process.exit(1);
}
console.log(`Copying ${Object.keys(secrets).length} secrets to the ${target} Worker:\n  ${Object.keys(secrets).sort().join('\n  ')}`);

const dir = mkdtempSync(path.join(tmpdir(), 'hotelone-secrets-'));
const json = path.join(dir, 'secrets.json');
try {
  writeFileSync(json, JSON.stringify(secrets), { mode: 0o600 });
  const args = ['wrangler', 'secret', 'bulk', json, ...(target === 'production' ? ['--env', 'production'] : [])];
  execFileSync('npx', args, { stdio: 'inherit' });
} finally {
  rmSync(dir, { recursive: true, force: true });
}
