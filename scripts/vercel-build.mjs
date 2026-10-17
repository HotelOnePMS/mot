#!/usr/bin/env node
/**
 * Build used on Vercel (see vercel.json).
 *
 * 1. Maps the connection-string names Vercel's Postgres integrations inject
 *    (Neon, Supabase, Prisma Postgres; the Prisma-tuned POSTGRES_PRISMA_URL
 *    first) onto the two names Prisma reads,
 *    DATABASE_URL and DIRECT_URL — same order as src/lib/db-url.ts.
 * 2. With a database: applies pending migrations and, when SEED_DEMO=true,
 *    creates the demo once (the seed never wipes on Vercel).
 *    Without one: still builds, so the first deploy works and a database can
 *    be connected afterwards (Vercel → Storage → Postgres, then redeploy).
 * 3. prisma generate + next build.
 */
import { execSync } from 'node:child_process';
import path from 'node:path';

const env = { ...process.env };
env.PATH = `${path.resolve('node_modules/.bin')}${path.delimiter}${env.PATH}`;

const isPostgres = (v) => !!v && /^postgres(ql)?:\/\//.test(v);
const first = (...keys) => keys.map((k) => env[k]).find(isPostgres);

const pooled = first('POSTGRES_PRISMA_URL', 'DATABASE_URL', 'POSTGRES_URL');
const direct = first('DIRECT_URL', 'DATABASE_URL_UNPOOLED', 'POSTGRES_URL_NON_POOLING') ?? pooled;
if (pooled) {
  env.DATABASE_URL = pooled;
  env.DIRECT_URL = direct;
}

const run = (cmd, extra = {}) => {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', env: { ...env, ...extra } });
};

run('prisma generate');

if (!pooled) {
  console.warn(
    '\n⚠ No Postgres connection string (DATABASE_URL / POSTGRES_URL / POSTGRES_PRISMA_URL).' +
      '\n  Building without migrations. Connect a database (Vercel → Storage → Postgres) and redeploy.',
  );
} else if (env.SKIP_MIGRATIONS === 'true') {
  console.log('\nSKIP_MIGRATIONS=true — not applying migrations.');
} else {
  run('prisma migrate deploy');
  if (env.SEED_DEMO === 'true') run('node prisma/seed.js', { NODE_ENV: 'production' });
}

run('next build');
