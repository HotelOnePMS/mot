-- Hotel phone lines: phone calls are voice sessions too (channel + caller ID).
ALTER TABLE "voice_sessions" ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'WEB',
ADD COLUMN "callerNumber" TEXT;

CREATE TABLE "voice_phone_lines" (
    "propertyId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "transferNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "voice_phone_lines_pkey" PRIMARY KEY ("propertyId")
);

ALTER TABLE "voice_phone_lines" ADD CONSTRAINT "voice_phone_lines_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
