import { execSync } from 'node:child_process';

/**
 * Bring the test database up to the current migrations. Nothing is deleted:
 * every test makes its own uniquely named hotels and people, so a fresh CI
 * database and a reused local one both work.
 */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('Set TEST_DATABASE_URL to a PostgreSQL database for integration tests (e.g. a local hotelone_test).');
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url, POSTGRES_PRISMA_URL: '', POSTGRES_URL: '' },
  });
}
