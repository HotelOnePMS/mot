-- PMS vendors connect through their own MCP server: a third way to reach a
-- hotel's PMS next to the desktop connector and the cloud browser. The MCP
-- endpoint lives in pms_connections."loginUrl" and its sealed auth in
-- "credentialsCipher", so no new columns or tables are needed.

-- AlterEnum
ALTER TYPE "PmsConnectionMode" ADD VALUE 'MCP';
