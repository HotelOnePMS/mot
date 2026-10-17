-- Direct bookings by an integration's API key keep the contact email it sent
-- on the booking; they no longer attach to an existing guest account.
ALTER TABLE "bookings" ADD COLUMN "guestEmail" TEXT;

-- Channel-wide counts (voice ceilings) and the rate-limit sweep.
CREATE INDEX "voice_sessions_channel_startedAt_idx" ON "voice_sessions"("channel", "startedAt");
