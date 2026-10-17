-- Voice-only and keep-your-PMS hotels: their own check-in/out times and
-- cancellation policy for the voice to quote, and where caller messages are emailed.

-- AlterTable
ALTER TABLE "voice_agent_configs" ADD COLUMN     "checkInTime" TEXT,
ADD COLUMN     "checkOutTime" TEXT,
ADD COLUMN     "cancellationPolicy" TEXT,
ADD COLUMN     "notifyEmail" TEXT;

-- Demo hotels that keep their own PMS now quote their own policy: give them one.
UPDATE "voice_agent_configs" SET
  "checkInTime" = '15:00',
  "checkOutTime" = '11:00',
  "cancellationPolicy" = 'Free cancellation until 24 hours before arrival; after that the first night is charged.'
WHERE "checkInTime" IS NULL
  AND "propertyId" IN (SELECT "id" FROM "properties" WHERE "isDemo" = true AND "setupPath" <> 'FULL');
