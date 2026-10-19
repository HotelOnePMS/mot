import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const alias = [
  { find: /^@\//, replacement: `${fileURLToPath(new URL('./src', import.meta.url))}/` },
  // next-auth imports `next/server` as ESM, which Node can't resolve without the extension.
  { find: /^next\/server$/, replacement: 'next/server.js' },
];
// Let Vite transform next-auth so the alias above applies to it.
const deps = { inline: ['next-auth', '@auth/core'] };

/**
 * unit         pure logic, no database (npm test)
 * integration  booking engine, sign-in, SCIM, front desk against a real
 *              PostgreSQL in TEST_DATABASE_URL, reset before the run
 *              (npm run test:integration — one file at a time, one database)
 */
export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: { name: 'unit', environment: 'node', include: ['tests/unit/**/*.test.ts'], setupFiles: ['tests/unit/setup.ts'], server: { deps } },
      },
      {
        resolve: { alias },
        test: {
          name: 'integration',
          environment: 'node',
          server: { deps },
          include: ['tests/integration/**/*.test.ts'],
          globalSetup: ['tests/integration/global-setup.ts'],
          setupFiles: ['tests/integration/setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
