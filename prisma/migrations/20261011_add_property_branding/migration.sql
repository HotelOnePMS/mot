-- Add SaaS branding / onboarding fields to properties.
-- tagline, primaryColor, logoUrl, type come from the business onboarding flow.
-- isDemo marks seeded demo data so the UI can label it honestly.
ALTER TABLE "properties" ADD COLUMN "tagline" TEXT,
                         ADD COLUMN "primaryColor" TEXT,
                         ADD COLUMN "logoUrl" TEXT,
                         ADD COLUMN "type" TEXT,
                         ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;
