/** Turns a stored channel-agent conversation into chat items for the console */
import type { ChannelAgentConversation } from '@prisma/client';
import { CONTEXT_PREFIX, pendingActions, type InputItem, type PendingAction } from './agent';
import { TOOL_LABELS, WRITE_TOOLS } from './tools';

export type ChatItem =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | {
      kind: 'tool';
      id: string;
      name: string;
      label: string;
      isChange: boolean;
      status: 'running' | 'done' | 'failed' | 'rejected' | 'awaiting_approval';
      detail: string | null;
    };

function messageText(content: unknown): string[] {
  if (typeof content === 'string') return [content];
  if (!Array.isArray(content)) return [];
  return content
    .map((part) => (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string' ? part.text : ''))
    .filter((text) => !text.startsWith(CONTEXT_PREFIX));
}

/** A one-line outcome for a change, taken from the tool's JSON result */
function changeDetail(result: Record<string, unknown>): string | null {
  if (typeof result.summary === 'string') return result.summary;
  if (Array.isArray(result.promotions)) {
    return (result.promotions as { name: string; status: string }[]).map((p) => `"${p.name}" ${p.status.toLowerCase()}`).join(', ');
  }
  if (typeof result.name === 'string' && typeof result.status === 'string') {
    return `"${result.name}" ${result.status.toLowerCase()}`;
  }
  return null;
}

export function conversationView(conversation: ChannelAgentConversation) {
  const items = JSON.parse(conversation.messages) as InputItem[];
  const pending: PendingAction[] = pendingActions(conversation);
  const pendingIds = new Set(pending.map((a) => a.callId));
  const chat: ChatItem[] = [];
  const toolItems = new Map<string, Extract<ChatItem, { kind: 'tool' }>>();

  for (const item of items) {
    if (item.type === 'message' && (item.role === 'user' || item.role === 'assistant')) {
      for (const text of messageText(item.content)) {
        if (text.trim()) chat.push({ kind: item.role, text });
      }
    } else if (item.type === 'function_call') {
      const tool: Extract<ChatItem, { kind: 'tool' }> = {
        kind: 'tool',
        id: item.call_id,
        name: item.name,
        label: TOOL_LABELS[item.name] ?? item.name,
        isChange: WRITE_TOOLS.has(item.name),
        status: pendingIds.has(item.call_id) ? 'awaiting_approval' : 'running',
        detail: null,
      };
      toolItems.set(item.call_id, tool);
      chat.push(tool);
    } else if (item.type === 'function_call_output') {
      const tool = toolItems.get(item.call_id ?? '');
      if (!tool) continue;
      let result: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(typeof item.output === 'string' ? item.output : '{}');
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) result = parsed;
      } catch {
        // not JSON
      }
      if (typeof result.error === 'string') {
        tool.status = result.rejected === true ? 'rejected' : 'failed';
        tool.detail = result.error.slice(0, 300);
      } else {
        tool.status = 'done';
        tool.detail = tool.isChange ? changeDetail(result) : null;
      }
    }
  }

  return {
    id: conversation.id,
    title: conversation.title,
    updatedAt: conversation.updatedAt,
    items: chat,
    pending: pending.map((action) => ({ callId: action.callId, toolName: action.toolName, ...action.preview })),
  };
}
