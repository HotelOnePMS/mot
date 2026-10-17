/**
 * Resolves the Postgres connection string from whichever name the host
 * injected. Vercel's Postgres integrations differ: Neon and Supabase set
 * POSTGRES_PRISMA_URL (pooled, tuned for Prisma: pgbouncer=true and a
 * cold-start-friendly connect timeout) alongside DATABASE_URL / POSTGRES_URL;
 * Prisma Postgres sets DATABASE_URL / POSTGRES_URL.
 * scripts/vercel-build.mjs applies the same order at build time.
 */
const POOLED = ['POSTGRES_PRISMA_URL', 'DATABASE_URL', 'POSTGRES_URL'] as const;

const isPostgres = (v: string | undefined): v is string => !!v && /^postgres(ql)?:\/\//.test(v);

export function databaseUrl(): string | undefined {
  for (const key of POOLED) {
    const value = process.env[key];
    if (isPostgres(value)) return value;
  }
  return undefined;
}

export const databaseConfigured = () => databaseUrl() !== undefined;
