-- Guest voice rate limits live in the database (shared by every server instance).
ALTER TABLE "voice_sessions" ADD COLUMN "clientKey" TEXT;

CREATE INDEX "voice_sessions_clientKey_startedAt_idx" ON "voice_sessions"("clientKey", "startedAt");
