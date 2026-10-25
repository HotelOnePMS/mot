-- Linking codes belong to the console session that showed them; a link keeps that session's sign-in method.
-- An alert sent as a template is held until the person reads it, with its own numbered replies.
-- IF NOT EXISTS: an earlier draft of 20261025_always_on_agent created some of these columns.
ALTER TABLE "staff_whatsapp_links" ADD COLUMN IF NOT EXISTS "codeSessionVersion" INTEGER;
ALTER TABLE "staff_whatsapp_links" ADD COLUMN IF NOT EXISTS "codeAuthMethod" TEXT;
ALTER TABLE "staff_whatsapp_links" ADD COLUMN IF NOT EXISTS "authMethod" TEXT NOT NULL DEFAULT 'password';
ALTER TABLE "staff_whatsapp_links" ADD COLUMN IF NOT EXISTS "alertUnseen" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "staff_whatsapp_links" ADD COLUMN IF NOT EXISTS "alertChoices" TEXT[] DEFAULT ARRAY[]::TEXT[];
