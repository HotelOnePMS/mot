/**
 * ElevenLabs Agents as the voice provider.
 *
 * HotelOne provisions two private agents in the hotel group's ElevenLabs
 * account — one for guests, one for staff — with our hotel tools registered
 * as *client* tools: ElevenLabs asks the browser to run them, and the
 * browser calls the same HotelOne endpoints GPT-Live uses (signed voice token
 * for guests; the permission-checked agent pipeline for staff). The guest
 * agent serves both a hotel's own front desk and the all-hotels concierge, so
 * it carries every booking-site tool (GUEST_AGENT_TOOLS); the prompt sent per
 * conversation says which apply, and the server refuses the rest. Hotel
 * specifics (name, today's date, house rules, skills, greeting) are sent per
 * conversation as prompt overrides. Agents and tools are re-synced whenever
 * their configuration in this file changes (tracked by a hash).
 *
 * Phone lines: each hotel that turns one on gets its own phone agent, which
 * the account owner points phone numbers at in ElevenLabs (Twilio, SIP trunk
 * or Exotel numbers). There is no browser on a phone call, so ElevenLabs
 * calls HotelOne directly: a conversation-initiation webhook when a call comes
 * in (we answer with the hotel's prompt and a signed session token) and
 * webhook tools during the call. Both carry a header secret derived from
 * the server secret.
 *
 * Agents are found by the ids stored under brand-free keys (VoiceProviderAgent),
 * never by name or tag, so renaming them (StayOS → HotelOne) just updates the
 * same agents in place on their next sync. The webhook header, the
 * stayos_session variable and the stayos_tool field are configured inside
 * every phone agent and tool at ElevenLabs: they keep their names for good.
 */
import { createHash } from 'crypto';
import { PRODUCT_NAME, PRODUCT_URL } from '@/config/product';
import { prisma } from '@/lib/prisma';
import { DomainError, notFound } from '../errors';
import { configuredPublicUrl, publicSiteUrl } from '../public-url';
import { GUEST_AGENT_TOOLS, PHONE_TOOLS, STAFF_TOOLS, deriveVoiceKey, sameKey, type FunctionToolSpec } from './live';
import { logError } from '@/server/log';

const DEFAULT_BASE = 'https://api.elevenlabs.io';
const BASE = (process.env.ELEVENLABS_API_BASE || DEFAULT_BASE).replace(/\/$/, '');
const LLM = process.env.ELEVENLABS_LLM || 'gemini-2.5-flash';
const CONFIG_VERSION = 2;

type Audience = 'guest' | 'staff';

/**
 * Provisioning rows are scoped to the ElevenLabs account (key + region) and
 * the deployment environment, so switching keys provisions fresh agents and
 * Preview deployments sharing the database never rewrite Production's agents.
 */
const ENVIRONMENT = process.env.ELEVENLABS_NAMESPACE || process.env.VERCEL_ENV || 'local';
function namespace(): string {
  const account = createHash('sha256').update(`${BASE}|${process.env.ELEVENLABS_API_KEY ?? ''}`).digest('hex').slice(0, 10);
  return `elevenlabs:${account}:${ENVIRONMENT}`;
}

export function elevenLabsConfigured(): boolean {
  return !!process.env.ELEVENLABS_API_KEY;
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

class ElevenLabsError extends Error {
  constructor(
    readonly status: number | null,
    readonly detail: string,
  ) {
    super(detail);
  }
}

async function call<T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown, timeoutMs = 30_000): Promise<T> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new DomainError(503, 'VOICE_DISABLED', 'The voice agent isn’t connected yet — add ELEVENLABS_API_KEY to turn it on.');
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: { 'xi-api-key': key, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    });
  } catch {
    throw new ElevenLabsError(null, 'network');
  }
  const text = await res.text();
  if (!res.ok) throw new ElevenLabsError(res.status, errorDetail(text));
  return (text ? JSON.parse(text) : {}) as T;
}

/** Pull a readable message out of ElevenLabs' error bodies ({detail: string | {message} | [{msg}]}). */
function errorDetail(text: string): string {
  try {
    const body = JSON.parse(text) as { detail?: unknown; message?: unknown };
    const d = body.detail ?? body.message;
    if (typeof d === 'string') return d;
    if (Array.isArray(d)) return d.map((x) => (x && typeof x === 'object' && 'msg' in x ? `${(x as { loc?: unknown[] }).loc?.join('.') ?? ''} ${(x as { msg: string }).msg}`.trim() : String(x))).join('; ');
    if (d && typeof d === 'object' && 'message' in d) return String((d as { message: unknown }).message);
  } catch {
    /* not JSON */
  }
  return text.slice(0, 200) || 'no details';
}

/** A reason the hotel's team can act on (never echoes the key). */
export function describeElevenLabsError(e: unknown): string {
  if (e instanceof DomainError) return e.message;
  if (!(e instanceof ElevenLabsError)) return 'Couldn’t start the voice line just now. Please try again.';
  const detail = e.detail.length > 280 ? `${e.detail.slice(0, 277)}…` : e.detail;
  switch (e.status) {
    case null:
      return 'Couldn’t reach ElevenLabs just now — try again in a moment.';
    case 401:
      if (/missing[_ ]?permission/i.test(e.detail)) return `This ElevenLabs key is missing a permission ${PRODUCT_NAME} needs — give it “ElevenLabs Agents” write access (or no restrictions). ElevenLabs says: ${detail}`;
      return 'ElevenLabs didn’t accept the API key. Re-check ELEVENLABS_API_KEY in Vercel (Settings → Environment Variables), then redeploy.';
    case 403:
      return `This ElevenLabs key isn’t allowed to manage agents. Create a key with “ElevenLabs Agents” write access (or no restrictions). ElevenLabs says: ${detail}`;
    case 402:
    case 429:
      return `ElevenLabs refused for quota or rate limits — check your plan and usage at elevenlabs.io. ElevenLabs says: ${detail}`;
    default:
      return `ElevenLabs returned an error (${e.status}). ${detail}`;
  }
}

// ---------------------------------------------------------------------------
// Desired configuration
// ---------------------------------------------------------------------------

type Schema = Record<string, unknown>;

/**
 * ElevenLabs takes a restricted JSON-schema dialect: no additionalProperties,
 * minimum/maximum, format or default, and every model-filled property should
 * carry a description. Nullable fields (OpenAI strict mode's way of saying
 * optional) become plain optional fields.
 */
function toElevenLabsSchema(node: Schema, name = 'value'): Schema {
  const out: Schema = {};
  const type = node.type;
  if (type === 'object' || node.properties) {
    out.type = 'object';
    const props = (node.properties ?? {}) as Record<string, Schema>;
    out.properties = Object.fromEntries(Object.entries(props).map(([k, v]) => [k, toElevenLabsSchema(v, k)]));
    const nullable = (v: Schema) => Array.isArray(v.type) && v.type.includes('null');
    const required = Array.isArray(node.required) ? (node.required as string[]).filter((k) => props[k] && !nullable(props[k])) : [];
    if (required.length) out.required = required;
    if (node.description) out.description = node.description;
    return out;
  }
  // A nullable array (['array', 'null']) is still an array: ElevenLabs needs its items.
  if (type === 'array' || (Array.isArray(type) && type.includes('array'))) {
    out.type = 'array';
    out.items = toElevenLabsSchema((node.items ?? { type: 'string' }) as Schema, name);
  } else {
    out.type = Array.isArray(type) ? (type.find((t) => t !== 'null') ?? 'string') : type;
    if (Array.isArray(node.enum)) out.enum = node.enum.map(String);
  }
  const range = [node.minimum !== undefined ? `min ${node.minimum}` : '', node.maximum !== undefined ? `max ${node.maximum}` : ''].filter(Boolean).join(', ');
  const base = typeof node.description === 'string' && node.description ? node.description : name.replace(/_/g, ' ');
  out.description = range ? `${base} (${range})` : base;
  return out;
}

function toolConfig(spec: FunctionToolSpec, audience: Audience) {
  const params = spec.parameters as Schema;
  const hasParams = Object.keys((params.properties ?? {}) as object).length > 0;
  return {
    type: 'client' as const,
    name: spec.name,
    description: spec.description,
    expects_response: true,
    // Staff requests run the full agent pipeline; guest lookups are quick.
    response_timeout_secs: audience === 'staff' ? 60 : 20,
    ...(hasParams ? { parameters: toElevenLabsSchema(params) } : {}),
  };
}

/** Shown on our agents in the ElevenLabs dashboard; nothing looks agents up by it. */
const BRAND_TAG = PRODUCT_NAME.toLowerCase();

const CLIENT_EVENTS = ['conversation_initiation_metadata', 'audio', 'interruption', 'user_transcript', 'agent_response', 'agent_response_correction', 'client_tool_call', 'agent_tool_response', 'vad_score', 'client_error', 'ping'];

function agentConfig(audience: Audience, toolIds: string[]) {
  const guest = audience === 'guest';
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  const suffix = ENVIRONMENT === 'production' ? '' : ` (${ENVIRONMENT})`;
  return {
    name: `${PRODUCT_NAME} — ${guest ? 'guest front desk' : 'staff hands-free'}${suffix}`,
    tags: [BRAND_TAG, guest ? 'guest' : 'staff', ENVIRONMENT],
    conversation_config: {
      agent: {
        first_message: guest ? 'Hi, thanks for calling. How can I help?' : 'Hi — what do you need?',
        language: 'en',
        // The real, hotel-specific prompt arrives per conversation as an override.
        prompt: {
          prompt: guest ? 'You are a hotel booking voice assistant. Use your tools for every fact.' : 'You are a hotel’s hands-free staff assistant. Use the front_desk tool for every request.',
          llm: LLM,
          temperature: 0.3,
          tool_ids: toolIds,
          built_in_tools: { end_call: { name: 'end_call', description: '', params: { system_tool_type: 'end_call' } } },
        },
        max_conversation_duration_message: guest ? 'I need to wrap up now — please call back any time.' : 'Wrapping up this session — tap Talk to start again.',
      },
      tts: { model_id: 'eleven_flash_v2', ...(voiceId ? { voice_id: voiceId } : {}) },
      conversation: { max_duration_seconds: guest ? 600 : 1800, client_events: CLIENT_EVENTS },
    },
    platform_settings: {
      auth: { enable_auth: true },
      // Only what each conversation actually sends: the hotel's prompt and greeting.
      overrides: { conversation_config_override: { agent: { first_message: true, prompt: { prompt: true } } } },
      // Provider-side backstop on top of HotelOne's own per-hotel limits.
      call_limits: {
        agent_concurrency_limit: Number(process.env.ELEVENLABS_MAX_CONCURRENT || 20),
        daily_limit: Number(process.env.ELEVENLABS_MAX_DAILY || 1000),
      },
    },
  };
}

// --- Phone lines -------------------------------------------------------------

/**
 * Header ElevenLabs sends on our phone webhooks; the value is derived from the
 * server secret. Wire contract: stored in every phone agent and tool at
 * ElevenLabs — never rename it (calls would fail until every line re-synced).
 */
export const PHONE_WEBHOOK_HEADER = 'X-StayOS-Webhook';
/** The signed session token for one call, handed to ElevenLabs by the initiation webhook. Wire contract, like the header. */
export const PHONE_SESSION_VARIABLE = 'stayos_session';
const PHONE_MAX_SECONDS = 600;

/**
 * Phone lines are scoped to the API host and environment but not to the API
 * key: numbers are pointed at these agents by hand, so rotating the key in
 * the same ElevenLabs account must keep the same agents and webhook secret.
 * (A different account is recovered by the 404 paths: agents are recreated.)
 */
function phoneNamespace(): string {
  const host = createHash('sha256').update(BASE).digest('hex').slice(0, 10);
  return `elevenlabs-phone:${host}:${ENVIRONMENT}`;
}

const phoneWebhookKey = () => deriveVoiceKey(`webhook|${phoneNamespace()}`);

/** Is this request really from our ElevenLabs agents? */
export function verifyPhoneWebhook(headerValue: string | null): boolean {
  return elevenLabsConfigured() && sameKey(headerValue, phoneWebhookKey());
}

/**
 * The public address ElevenLabs calls back (see publicSiteUrl). Preview
 * deployments sit behind Vercel Authentication, which would refuse
 * ElevenLabs' calls, so phone lines belong on production.
 */
export function phoneWebhookBase(): string {
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production' && !configuredPublicUrl()) {
    throw new DomainError(503, 'PHONE_URL', 'Phone lines run on your production deployment — preview deployments can’t receive ElevenLabs’ calls.');
  }
  const base = publicSiteUrl() ?? '';
  // Plain http only reaches a local mock of the API, never the real one.
  if (/^https:\/\/[^/]+/.test(base) || (/^http:\/\/[^/]+/.test(base) && BASE !== DEFAULT_BASE)) return base;
  throw new DomainError(
    503,
    'PHONE_URL',
    `Phone calls need ${PRODUCT_NAME} on a public https address — set HOTELONE_PUBLIC_URL (for example ${PRODUCT_URL}; the older STAYOS_PUBLIC_URL also works) and redeploy.`,
  );
}

/** A phone tool runs on our server: ElevenLabs POSTs the model's arguments plus the call's session token. */
function phoneToolConfig(spec: FunctionToolSpec, base: string) {
  const params = toElevenLabsSchema(spec.parameters as Schema) as { properties?: Record<string, Schema>; required?: string[] };
  return {
    type: 'webhook' as const,
    name: spec.name,
    description: spec.description,
    response_timeout_secs: 20,
    api_schema: {
      url: `${base}/api/voice/phone/tool`,
      method: 'POST',
      content_type: 'application/json',
      request_headers: { [PHONE_WEBHOOK_HEADER]: phoneWebhookKey() },
      request_body_schema: {
        type: 'object',
        description: `Arguments for ${spec.name}`,
        properties: {
          ...(params.properties ?? {}),
          // Filled by ElevenLabs, never by the model. Wire contract: keep these names.
          stayos_tool: { type: 'string', constant_value: spec.name },
          stayos_session: { type: 'string', dynamic_variable: PHONE_SESSION_VARIABLE },
        },
        ...(params.required?.length ? { required: params.required } : {}),
      },
    },
  };
}

interface PhoneAgentInput {
  hotel: string;
  /** Short, unique per hotel: hotel names aren't (and are chosen by each tenant). */
  ref: string;
  /** Only while the line is on: a paused line never puts callers through. */
  transferNumber: string | null;
  base: string;
}

function phoneAgentConfig(input: PhoneAgentInput, toolIds: string[]) {
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  // Phone audio is 8 kHz μ-law (Twilio, SIP/PCMU); "auto" leaves it to ElevenLabs.
  const audio = process.env.ELEVENLABS_PHONE_AUDIO_FORMAT || 'ulaw_8000';
  const format = audio === 'auto' ? null : audio;
  const suffix = ENVIRONMENT === 'production' ? '' : ` (${ENVIRONMENT})`;
  return {
    name: `${PRODUCT_NAME} — ${input.hotel.slice(0, 70)} phone · ${input.ref}${suffix}`,
    tags: [BRAND_TAG, 'phone', ENVIRONMENT],
    conversation_config: {
      agent: {
        // Replaced per call by the initiation webhook; this only plays if HotelOne couldn't be reached.
        first_message: 'Thanks for calling. I’m sorry — our assistant can’t take calls right now. Please try again in a few minutes.',
        language: 'en',
        dynamic_variables: { dynamic_variable_placeholders: { [PHONE_SESSION_VARIABLE]: '' } },
        prompt: {
          prompt: 'This hotel phone call could not load its details. Apologise briefly, ask the caller to try again in a few minutes, then end the call.',
          llm: LLM,
          temperature: 0.3,
          tool_ids: toolIds,
          built_in_tools: {
            end_call: { name: 'end_call', description: '', params: { system_tool_type: 'end_call' } },
            // Sent as null when off: updates merge, so leaving it out would keep an old transfer.
            transfer_to_number: input.transferNumber
              ? {
                  name: 'transfer_to_number',
                  description: '',
                  params: {
                    system_tool_type: 'transfer_to_number',
                    enable_client_message: true,
                    transfers: [
                      {
                        transfer_destination: { type: 'phone', phone_number: input.transferNumber },
                        condition: 'The caller asks to speak with a person, or has an urgent problem the assistant cannot solve with its tools.',
                        transfer_type: 'conference',
                      },
                    ],
                  },
                }
              : null,
          },
        },
        max_conversation_duration_message: 'I need to wrap up now — please call back any time.',
      },
      asr: { user_input_audio_format: format },
      tts: { model_id: 'eleven_flash_v2', ...(voiceId ? { voice_id: voiceId } : {}), agent_output_audio_format: format },
      conversation: { max_duration_seconds: PHONE_MAX_SECONDS },
      // A line left open in silence shouldn't run up minutes.
      turn: { silence_end_call_timeout: 45 },
    },
    platform_settings: {
      auth: { enable_auth: true },
      overrides: {
        enable_conversation_initiation_client_data_from_webhook: true,
        conversation_config_override: { agent: { first_message: true, prompt: { prompt: true } } },
      },
      workspace_overrides: {
        conversation_initiation_client_data_webhook: { url: `${input.base}/api/voice/phone/start`, request_headers: { [PHONE_WEBHOOK_HEADER]: phoneWebhookKey() } },
      },
      call_limits: {
        agent_concurrency_limit: Number(process.env.ELEVENLABS_MAX_CONCURRENT || 20),
        daily_limit: Number(process.env.ELEVENLABS_MAX_DAILY || 1000),
      },
    },
  };
}

const hash = (v: unknown) => createHash('sha256').update(JSON.stringify({ v: CONFIG_VERSION, ...((v as object) ?? {}) })).digest('hex');

// ---------------------------------------------------------------------------
// Provisioning (create once, update on change)
// ---------------------------------------------------------------------------

type Db = Pick<typeof prisma, 'voiceProviderAgent' | '$executeRaw'>;

const saveRow = (db: Db, key: string, externalId: string, configHash: string) =>
  db.voiceProviderAgent.upsert({ where: { key }, create: { key, externalId, configHash }, update: { externalId, configHash } });

async function syncTool(db: Db, key: string, config: object): Promise<string> {
  const configHash = hash(config);
  const row = await db.voiceProviderAgent.findUnique({ where: { key } });
  if (row?.configHash === configHash) return row.externalId;
  let id: string | null = null;
  if (row) {
    try {
      await call('PATCH', `/v1/convai/tools/${encodeURIComponent(row.externalId)}`, { tool_config: config });
      id = row.externalId;
    } catch (e) {
      if (!(e instanceof ElevenLabsError) || e.status !== 404) throw e;
    }
  }
  if (!id) id = (await call<{ id: string }>('POST', '/v1/convai/tools', { tool_config: config })).id;
  await saveRow(db, key, id, configHash);
  return id;
}

const agentKey = (audience: Audience) => `${namespace()}:${audience.toUpperCase()}`;
const ownAgent = (audience: Audience) => (audience === 'guest' ? process.env.ELEVENLABS_GUEST_AGENT_ID : process.env.ELEVENLABS_STAFF_AGENT_ID);

/** Forget that an agent is in sync (e.g. it was deleted in ElevenLabs), so the next sync re-checks it. */
const invalidateAgent = (audience: Audience) => prisma.voiceProviderAgent.updateMany({ where: { key: agentKey(audience) }, data: { configHash: '' } });

async function syncAgent(audience: Audience): Promise<string> {
  const own = ownAgent(audience);
  if (own) return own; // bring-your-own agent: managed in ElevenLabs

  const specs = audience === 'guest' ? GUEST_AGENT_TOOLS : STAFF_TOOLS;
  const desiredHash = hash({ tools: specs.map((s) => toolConfig(s, audience)), agent: agentConfig(audience, []) });
  return provisionAgent(agentKey(audience), desiredHash, async (tx) => {
    const toolIds: string[] = [];
    for (const spec of specs) toolIds.push(await syncTool(tx, `${namespace()}:tool:${audience}:${spec.name}`, toolConfig(spec, audience)));
    return agentConfig(audience, toolIds);
  });
}

const phoneAgentPrefix = () => `${phoneNamespace()}:agent:`;
const phoneAgentKey = (propertyId: string) => `${phoneAgentPrefix()}${propertyId}`;

async function phoneAgentInput(propertyId: string): Promise<PhoneAgentInput> {
  const line = await prisma.voicePhoneLine.findUnique({ where: { propertyId }, select: { enabled: true, transferNumber: true, property: { select: { name: true } } } });
  if (!line) throw notFound('Phone line');
  return { hotel: line.property.name, ref: propertyId.slice(-6), transferNumber: line.enabled ? line.transferNumber : null, base: phoneWebhookBase() };
}

/** Make sure this hotel's phone agent exists at ElevenLabs and matches its settings. */
async function syncPhoneAgent(propertyId: string): Promise<string> {
  const input = await phoneAgentInput(propertyId);
  const desiredHash = hash({ tools: PHONE_TOOLS.map((s) => phoneToolConfig(s, input.base)), agent: phoneAgentConfig(input, []) });
  return provisionAgent(phoneAgentKey(propertyId), desiredHash, async (tx) => {
    // Every hotel's phone agent shares one set of phone tools: sync them one hotel at a time.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${phoneNamespace()}:tools`}))`;
    const toolIds: string[] = [];
    for (const spec of PHONE_TOOLS) toolIds.push(await syncTool(tx, `${phoneNamespace()}:tool:${spec.name}`, phoneToolConfig(spec, input.base)));
    return phoneAgentConfig(input, toolIds);
  });
}

// --- WhatsApp -------------------------------------------------------------------
// A hotel's phone agent can also be assigned to a WhatsApp number in ElevenLabs
// (Agents → WhatsApp). The same initiation webhook fires for WhatsApp chats and
// calls, with the guest's WhatsApp number as caller_id and the business's Meta
// phone-number ID (digits, no "+") as called_number.

interface WhatsAppAccount {
  phone_number_id?: string;
  phone_number?: string;
  phone_number_name?: string | null;
  assigned_agent_id?: string | null;
}

let whatsAppCache: { at: number; accounts: WhatsAppAccount[] } | null = null;

async function whatsAppAccounts(maxAgeMs: number): Promise<WhatsAppAccount[]> {
  if (whatsAppCache && Date.now() - whatsAppCache.at < maxAgeMs) return whatsAppCache.accounts;
  // Short timeout: this can run while a guest waits for the first reply.
  const res = await call<{ items?: WhatsAppAccount[] }>('GET', '/v1/convai/whatsapp-accounts', undefined, 3_000);
  whatsAppCache = { at: Date.now(), accounts: res.items ?? [] };
  return whatsAppCache.accounts;
}

/**
 * Is this incoming conversation a WhatsApp chat or call? Phone calls carry a
 * call SID or a "+" number; WhatsApp sends the business's phone-number ID.
 * Confirmed against the account's WhatsApp numbers when they can be read.
 */
export async function isWhatsAppConversation(calledNumber: string | null | undefined, callSid: string | null | undefined): Promise<boolean> {
  const id = (calledNumber ?? '').trim();
  if (callSid || !/^\d{6,}$/.test(id)) return false;
  try {
    const known = (accounts: WhatsAppAccount[]) => accounts.some((a) => a.phone_number_id === id);
    return known(await whatsAppAccounts(5 * 60_000)) || known(await whatsAppAccounts(0));
  } catch {
    return true; // can't check: digits and no call SID is WhatsApp's shape
  }
}

/** Which hotel a phone agent answers for (only agents this deployment created). */
export async function phonePropertyForAgent(agentId: string): Promise<string | null> {
  if (!agentId) return null;
  const prefix = phoneAgentPrefix();
  const row = await prisma.voiceProviderAgent.findFirst({ where: { externalId: agentId, key: { startsWith: prefix } }, select: { key: true } });
  return row ? row.key.slice(prefix.length) : null;
}

export interface PhoneNumberInfo {
  phoneNumber: string;
  label: string | null;
  provider: string;
}

/**
 * Sync this hotel's phone agent (recreating it if it was deleted in
 * ElevenLabs) and list the numbers in the account that ring it.
 */
export async function phoneLineStatus(propertyId: string): Promise<{ agentId: string; agentName: string; numbers: PhoneNumberInfo[] }> {
  try {
    let agentId = await syncPhoneAgent(propertyId);
    let agent: { name?: string };
    try {
      agent = await call<{ name?: string }>('GET', `/v1/convai/agents/${encodeURIComponent(agentId)}`);
    } catch (e) {
      if (!(e instanceof ElevenLabsError) || e.status !== 404) throw e;
      await prisma.voiceProviderAgent.updateMany({ where: { key: phoneAgentKey(propertyId) }, data: { configHash: '' } });
      agentId = await syncPhoneAgent(propertyId);
      agent = await call<{ name?: string }>('GET', `/v1/convai/agents/${encodeURIComponent(agentId)}`);
    }
    type Listed = { phone_number?: string; label?: string | null; provider?: string; assigned_agent?: { agent_id?: string } | null };
    const listed = await call<Listed[] | { phone_numbers?: Listed[] }>('GET', `/v1/convai/phone-numbers?agent_id=${encodeURIComponent(agentId)}`);
    const all = Array.isArray(listed) ? listed : (listed.phone_numbers ?? []);
    const numbers = all
      .filter((n) => n.assigned_agent?.agent_id === agentId && n.phone_number)
      .map((n) => ({ phoneNumber: n.phone_number!, label: n.label ?? null, provider: n.provider ?? 'phone' }));
    // WhatsApp numbers answered by the same agent (a key without WhatsApp access just shows none).
    const whatsApp = await whatsAppAccounts(0).catch(() => [] as WhatsAppAccount[]);
    for (const w of whatsApp) {
      if (w.assigned_agent_id === agentId && w.phone_number) numbers.push({ phoneNumber: w.phone_number, label: w.phone_number_name ?? null, provider: 'whatsapp' });
    }
    return { agentId, agentName: agent.name ?? phoneAgentConfig(await phoneAgentInput(propertyId), []).name, numbers };
  } catch (e) {
    if (e instanceof DomainError) throw e;
    logError('voice/elevenlabs', 'ElevenLabs phone line sync failed:', e instanceof ElevenLabsError ? `${e.status} ${e.detail}` : e);
    throw new DomainError(502, 'VOICE_UPSTREAM', describeElevenLabsError(e));
  }
}

// --- Connecting numbers from the console ----------------------------------------
// The same thing the account owner can do in ElevenLabs (Agents → Phone numbers),
// without handing anyone that account: HotelOne imports the number and points it
// at the hotel's own phone agent.

type AccountNumber = { phone_number_id?: string; phone_number?: string; label?: string | null; provider?: string; assigned_agent?: { agent_id?: string; agent_name?: string } | null };

/** A number in the ElevenLabs account, as platform admins pick from it. */
export interface AccountNumberInfo {
  id: string;
  phoneNumber: string;
  label: string | null;
  provider: string;
  /** The agent it rings now (another hotel's, or none). */
  agentName: string | null;
  /** Already rings this hotel. */
  thisHotel: boolean;
}

async function withPhoneErrors<T>(what: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof DomainError) throw e;
    logError('voice/elevenlabs', `ElevenLabs ${what} failed:`, e instanceof ElevenLabsError ? `${e.status} ${e.detail}` : e);
    throw new DomainError(502, 'VOICE_UPSTREAM', describeElevenLabsError(e));
  }
}

const TWILIO_BASE = (process.env.TWILIO_API_BASE || 'https://api.twilio.com').replace(/\/$/, '');

/**
 * Proves whoever is connecting the number controls it: the Twilio account
 * must accept the credentials and hold the number. Checked before anything
 * changes at ElevenLabs, so nobody can point another hotel's number at theirs.
 */
async function verifyTwilioNumber(accountSid: string, authToken: string, phoneNumber: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${TWILIO_BASE}/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(phoneNumber)}`, {
      headers: { Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}` },
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
    });
  } catch {
    throw new DomainError(502, 'VOICE_UPSTREAM', 'Couldn’t reach Twilio just now — try again in a moment.');
  }
  if (res.status === 401 || res.status === 404) throw new DomainError(400, 'TWILIO_AUTH', 'Twilio didn’t accept that Account SID and Auth Token. Copy both again from the Twilio Console home page.');
  if (!res.ok) throw new DomainError(502, 'VOICE_UPSTREAM', `Twilio returned an error (${res.status}). Try again in a moment.`);
  const body = (await res.json().catch(() => ({}))) as { incoming_phone_numbers?: { phone_number?: string }[] };
  if (!body.incoming_phone_numbers?.some((n) => n.phone_number === phoneNumber)) {
    throw new DomainError(400, 'TWILIO_NUMBER', `${phoneNumber} isn’t a number in that Twilio account. Check it under Phone Numbers → Active numbers in Twilio.`);
  }
}

/**
 * Import a Twilio number into ElevenLabs and point it at this hotel's phone
 * agent. ElevenLabs sets the number's voice webhook in Twilio itself. The
 * Twilio credentials go straight to Twilio (to check them) and ElevenLabs;
 * HotelOne doesn't keep them.
 */
export async function connectTwilioNumber(propertyId: string, input: { phoneNumber: string; accountSid: string; authToken: string }): Promise<void> {
  await verifyTwilioNumber(input.accountSid, input.authToken, input.phoneNumber);
  await withPhoneErrors('number import', async () => {
    const agentId = await syncPhoneAgent(propertyId);
    const hotel = (await phoneAgentInput(propertyId)).hotel;
    // Already in the account (connected before, or to another agent): point it at this hotel — Twilio just confirmed it's theirs.
    const existing = (await call<AccountNumber[]>('GET', '/v1/convai/phone-numbers')).find((n) => n.phone_number === input.phoneNumber);
    if (existing?.phone_number_id) {
      await call('PATCH', `/v1/convai/phone-numbers/${encodeURIComponent(existing.phone_number_id)}`, { agent_id: agentId });
      return;
    }
    const created = await call<{ phone_number_id: string }>('POST', '/v1/convai/phone-numbers', {
      provider: 'twilio',
      phone_number: input.phoneNumber,
      label: `${hotel.slice(0, 60)} · ${PRODUCT_NAME}`,
      sid: input.accountSid,
      token: input.authToken,
      agent_id: agentId,
    });
    // Assign explicitly too, in case the import didn't take agent_id.
    await call('PATCH', `/v1/convai/phone-numbers/${encodeURIComponent(created.phone_number_id)}`, { agent_id: agentId });
  });
}

/** Every number in the ElevenLabs account (platform admins only: it spans every hotel). */
export async function accountNumbers(propertyId: string): Promise<AccountNumberInfo[]> {
  return withPhoneErrors('number list', async () => {
    const agentId = await syncPhoneAgent(propertyId);
    const all = await call<AccountNumber[]>('GET', '/v1/convai/phone-numbers');
    return all
      .filter((n) => n.phone_number_id && n.phone_number)
      .map((n) => ({
        id: n.phone_number_id!,
        phoneNumber: n.phone_number!,
        label: n.label ?? null,
        provider: n.provider ?? 'phone',
        agentName: n.assigned_agent?.agent_name ?? null,
        thisHotel: n.assigned_agent?.agent_id === agentId,
      }));
  });
}

/** Point a number that's already in the ElevenLabs account at this hotel's phone agent. */
export async function assignAccountNumber(propertyId: string, phoneNumberId: string): Promise<void> {
  await withPhoneErrors('number assignment', async () => {
    const agentId = await syncPhoneAgent(propertyId);
    await call('PATCH', `/v1/convai/phone-numbers/${encodeURIComponent(phoneNumberId)}`, { agent_id: agentId });
  });
}

/**
 * Create or update one agent (and, through `build`, its tools) so it matches
 * `desiredHash`. `build` syncs the tools and returns the agent body.
 */
async function provisionAgent(key: string, desiredHash: string, build: (tx: Db) => Promise<object>): Promise<string> {
  // Fast path without the lock: nothing changed since the last sync.
  const cached = await prisma.voiceProviderAgent.findUnique({ where: { key } });
  if (cached?.configHash === desiredHash) return cached.externalId;

  // One instance provisions at a time (the lock is released with the transaction).
  // Failures are returned, not thrown, so the transaction still commits the rows
  // of anything already created at ElevenLabs — a retry reuses them (no orphans).
  const outcome = await prisma.$transaction(
    async (tx): Promise<{ id: string } | { error: unknown }> => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      try {
        const row = await tx.voiceProviderAgent.findUnique({ where: { key } });
        if (row?.configHash === desiredHash) return { id: row.externalId };
        const body = await build(tx);
        let id: string | null = null;
        if (row) {
          try {
            await call('PATCH', `/v1/convai/agents/${encodeURIComponent(row.externalId)}`, body);
            id = row.externalId;
          } catch (e) {
            if (!(e instanceof ElevenLabsError) || e.status !== 404) throw e;
          }
        }
        if (!id) id = (await call<{ agent_id: string }>('POST', '/v1/convai/agents/create', body)).agent_id;
        await saveRow(tx, key, id, desiredHash);
        return { id };
      } catch (error) {
        return { error };
      }
    },
    { maxWait: 15_000, timeout: 90_000 },
  );
  if ('error' in outcome) throw outcome.error;
  return outcome.id;
}

/** A single-use signed URL (include_conversation_id makes ElevenLabs burn it on first use). */
async function signedUrlFor(agentId: string): Promise<{ signedUrl: string; conversationId: string | null }> {
  const res = await call<{ signed_url: string; conversation_id?: string }>(
    'GET',
    `/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}&include_conversation_id=true`,
  );
  let conversationId = res.conversation_id ?? null;
  if (!conversationId) {
    try {
      conversationId = new URL(res.signed_url).searchParams.get('conversation_id');
    } catch {
      /* keep null */
    }
  }
  return { signedUrl: res.signed_url, conversationId };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Everything the browser needs to start one conversation: a single-use
 * signed URL for the private agent, the hotel-specific prompt and greeting
 * (sent as overrides), and the client tools to register.
 */
export async function startElevenLabsConversation(input: {
  audience: Audience;
  prompts: { instructions: string; backendInstructions: string };
  firstMessage: string;
  tools: FunctionToolSpec[];
}): Promise<{ signedUrl: string; conversationId: string | null; prompt: string; firstMessage: string; tools: string[] }> {
  try {
    let agentId = await syncAgent(input.audience);
    let signed: { signedUrl: string; conversationId: string | null };
    try {
      signed = await signedUrlFor(agentId);
    } catch (e) {
      // Our agent vanished at ElevenLabs (deleted in the dashboard): recreate it once.
      if (!(e instanceof ElevenLabsError) || e.status !== 404 || ownAgent(input.audience)) throw e;
      await invalidateAgent(input.audience);
      agentId = await syncAgent(input.audience);
      signed = await signedUrlFor(agentId);
    }
    // The browser registers every tool the agent has, so a stray call gets a clear answer instead of an SDK error.
    const tools = input.audience === 'guest' ? GUEST_AGENT_TOOLS : input.tools;
    return { ...signed, prompt: singleModelPrompt(input.prompts), firstMessage: input.firstMessage, tools: tools.map((t) => t.name) };
  } catch (e) {
    if (e instanceof DomainError) throw e;
    logError('voice/elevenlabs', 'ElevenLabs conversation start failed:', e instanceof ElevenLabsError ? `${e.status} ${e.detail}` : e);
    throw new DomainError(502, 'VOICE_UPSTREAM', describeElevenLabsError(e));
  }
}

/** GPT-Live splits voice and task prompts; an ElevenLabs agent is one model doing both. */
export function singleModelPrompt(p: { instructions: string; backendInstructions: string }) {
  return [
    'You talk with people by voice and you can call tools directly. Wherever these instructions say "delegate", call the right tool yourself, then answer from its result.',
    '',
    '# How you speak',
    p.instructions,
    '',
    '# How you work',
    p.backendInstructions,
  ].join('\n');
}

/** Console setup check: the key works, and both agents exist at ElevenLabs and are in sync. */
export async function checkElevenLabs(): Promise<{ model: string; role: string; ok: boolean; reason: string | null }[]> {
  try {
    await call('GET', '/v1/convai/agents?page_size=1');
  } catch (e) {
    return [{ model: 'ElevenLabs API key', role: 'Account', ok: false, reason: describeElevenLabsError(e) }];
  }
  const rows: { model: string; role: string; ok: boolean; reason: string | null }[] = [{ model: 'ElevenLabs API key', role: 'Account', ok: true, reason: null }];
  for (const audience of ['guest', 'staff'] as const) {
    const role = audience === 'guest' ? 'Guest voice agent' : 'Staff voice agent';
    try {
      let id = await syncAgent(audience);
      try {
        await call('GET', `/v1/convai/agents/${encodeURIComponent(id)}`);
      } catch (e) {
        if (!(e instanceof ElevenLabsError) || e.status !== 404 || ownAgent(audience)) throw e;
        await invalidateAgent(audience);
        id = await syncAgent(audience);
      }
      rows.push({ model: id, role, ok: true, reason: null });
    } catch (e) {
      rows.push({ model: ownAgent(audience) ?? LLM, role, ok: false, reason: describeElevenLabsError(e) });
    }
  }
  return rows;
}
