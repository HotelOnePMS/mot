-- Per-property Classic/Agentic interface mode + agent audit trail.
CREATE TYPE "InterfaceMode" AS ENUM ('CLASSIC', 'AGENTIC');

ALTER TABLE "properties" ADD COLUMN "interfaceMode" "InterfaceMode" NOT NULL DEFAULT 'CLASSIC';

CREATE TABLE "agent_audit_logs" (
  "id" TEXT NOT NULL,
  "propertyId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "detail" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agent_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agent_audit_logs_propertyId_createdAt_idx" ON "agent_audit_logs"("propertyId", "createdAt");

ALTER TABLE "agent_audit_logs" ADD CONSTRAINT "agent_audit_logs_propertyId_fkey"
  FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_audit_logs" ADD CONSTRAINT "agent_audit_logs_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
