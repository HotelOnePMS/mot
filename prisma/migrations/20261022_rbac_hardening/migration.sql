-- RBAC hardening (additive, safe to re-run).
-- sessionVersion: bumped on role / active / password / email changes so existing sessions end.
-- mustChangePassword: set when someone else chose the user's password.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "sessionVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
