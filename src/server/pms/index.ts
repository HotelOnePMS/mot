/**
 * PMS vendors' MCP servers as a native way into a hotel's PMS.
 *
 *   connection.ts  connect / test / refresh / disconnect, console status view
 *   mcp-client.ts  Streamable-HTTP MCP client (JSON + SSE, sessions, timeouts)
 *   url-guard.ts   SSRF guard for vendor URLs
 *   contract.ts    the recommended tool contract + matching + arg adaptation
 *   tools.ts       discovered tools cached as AgentSkill rows (kind PMS_TOOL)
 *   intent.ts      deterministic task → contract operation planning
 *   executor.ts    runs one bridge task over MCP (contract path, then AI planner)
 *   run.ts         claims + persists bridge tasks for MCP connections
 *   events.ts      signed inbound events → activity log
 */
export { connectMcp, disconnectMcp, getMcpStatus, isMcpConnection, probeMcp, refreshTools, testMcp, clientFor, type ConnectMcpInput, type McpAuthInput, type McpStatusView } from './connection';
export { executeMcpTask, isChangeKind, toolAllowed, CHANGE_KINDS, MAX_TOOL_CALLS, TASK_TIMEOUT_MS, PMS_MCP_MODEL, type ExecuteOptions, type McpCallRecord, type McpTaskInput, type McpTaskResult } from './executor';
export { runMcpBridgeTask, runQueuedMcpTasks, persistResult, scheduleMcpTask, runMcpTaskInline } from './run';
export { displayUrl } from './url-guard';
export { CONTRACT, CONTRACT_VERSION, EVENT_TYPES, contractDocument, coverage, matchContract, adaptArgs, isReadOnlyTool, isForbiddenTool, type ContractOperation, type ContractOperationName, type ContractMapping } from './contract';
export { eventsSecret, eventsUrl, eventsPath, signEvent, verifyEventSignature, recordPmsEvent, summariseEvent, EVENT_SIGNATURE_HEADER, EVENT_TIMESTAMP_HEADER, EVENT_TOLERANCE_SECONDS, EVENT_MAX_BYTES } from './events';
export { listCachedTools, deleteCachedTools, PMS_TOOL_KIND, PMS_TOOL_SOURCE, PMS_TOOL_KEY_PREFIX, type CachedPmsTool, type PmsToolBody } from './tools';
export { McpClient, MCP_PROTOCOL_VERSION, type McpAuth, type McpTool, type McpServerInfo, type McpCallResult } from './mcp-client';
export { McpError, toDomainError, type McpErrorCode } from './errors';
export { assertSafeMcpUrl, parseMcpUrl, classifyAddress } from './url-guard';
export { planTask, type PlannedOperation } from './intent';
