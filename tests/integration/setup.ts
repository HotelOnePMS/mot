// Point Prisma at the test database before anything imports it.
const url = process.env.TEST_DATABASE_URL ?? '';
process.env.DATABASE_URL = url;
process.env.DIRECT_URL = url;
delete process.env.POSTGRES_PRISMA_URL;
delete process.env.POSTGRES_URL;
process.env.NEXTAUTH_SECRET ||= 'integration-test-secret-0123456789abcdef';
process.env.HOTEL_TIMEZONE ||= 'America/Los_Angeles';
delete process.env.RESEND_API_KEY;
