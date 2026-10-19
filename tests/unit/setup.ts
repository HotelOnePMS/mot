// Unit tests never reach a database; signing secrets are fixed so results are stable.
process.env.NEXTAUTH_SECRET ||= 'unit-test-secret-unit-test-secret-0123';
process.env.HOTEL_TIMEZONE ||= 'America/Los_Angeles';
