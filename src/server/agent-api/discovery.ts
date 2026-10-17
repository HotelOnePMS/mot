/**
 * Discovery documents for AI assistants and crawlers: /llms.txt (short),
 * /llms-full.txt (every tool and endpoint), /.well-known/agent-card.json
 * (A2A-style agent card) and /.well-known/mcp.json (where the MCP server
 * is). All absolute URLs use the origin the caller reached us on.
 */
import { PRODUCT_DESCRIPTION, PRODUCT_NAME, PRODUCT_SUPPORT_EMAIL, PRODUCT_URL } from '@/config/product';
import type { JsonSchema } from '../concierge';
import { addDaysISO, hotelToday } from '../dates';
import { PUBLISHED_LIMITS } from './http';
import { MCP_LATEST_VERSION, MCP_PROTOCOL_VERSIONS, MCP_SERVER_VERSION } from './mcp';
import { API_VERSION } from './openapi';
import { REST_BASE } from './rest';
import { toolCatalog } from './tools';

/** The URLs every document points at. */
export function agentUrls(origin: string) {
  return {
    mcp: `${origin}/api/mcp`,
    hotelMcpTemplate: `${origin}/api/mcp/hotels/{propertyId}`,
    rest: `${origin}${REST_BASE}`,
    openapi: `${origin}/openapi.json`,
    llms: `${origin}/llms.txt`,
    llmsFull: `${origin}/llms-full.txt`,
    agentCard: `${origin}/.well-known/agent-card.json`,
    mcpManifest: `${origin}/.well-known/mcp.json`,
    page: `${origin}/assistants`,
    directory: `${origin}/properties`,
  };
}

const EXAMPLES = [
  'Find me a room in Santa Cruz next weekend for two and book it.',
  'Is parking free at The Saltwater Inn?',
  'Something in Monterey for 3 nights from November 12, under $250 a night.',
  'Find my booking — code ABC123, last name Smith.',
];

function limitsText(): string {
  const l = PUBLISHED_LIMITS;
  return [
    `- ${l.read.anonymous!.max} requests a minute per IP address (${l.read.withKey.max} a minute with an API key).`,
    `- Booking requests: ${l.request.anonymous!.max} an hour per IP (${l.request.withKey.max} with a key). Bookings: ${l.book.withKey.max} an hour per key.`,
    `- Booking lookups: ${l.lookup.anonymous!.max} an hour per IP (${l.lookup.withKey.max} with a key).`,
    '- Over the limit: HTTP 429 with Retry-After (MCP tool calls return an error result the model can explain).',
  ].join('\n');
}

/** /llms.txt — the short version (llmstxt.org format). */
export function llmsTxt(origin: string): string {
  const u = agentUrls(origin);
  return `# ${PRODUCT_NAME}

> ${PRODUCT_NAME} lists independent hotels, inns and motels with their own booking sites. AI assistants can search them, check live availability and prices, answer guests' questions and book — through an MCP server or a REST API. No sign-up or key is needed to search or to get a booking link.

${PRODUCT_DESCRIPTION}

## Connect

- [MCP server (all hotels)](${u.mcp}): Streamable HTTP, stateless JSON-RPC (protocol ${MCP_PROTOCOL_VERSIONS.join(', ')}). Add it as a custom connector or remote MCP server; no authentication needed.
- One hotel's own MCP server: ${u.hotelMcpTemplate} — the same tools for that hotel only (no hotel id needed).
- [REST API](${u.rest}) and its [OpenAPI 3.1 description](${u.openapi}) — import as a GPT Action or any OpenAPI tool.
- [Agent card](${u.agentCard}) · [MCP manifest](${u.mcpManifest}) · [Full details for models](${u.llmsFull})
- [How to connect ChatGPT, Claude, Grok, Le Chat and others](${u.page})

## Booking flow

1. search_hotels (GET ${REST_BASE}/hotels) with a place and, if known, dates (YYYY-MM-DD), guests and rooms.
2. check_availability (GET ${REST_BASE}/hotels/{propertyId}/availability) for the hotel the person picks.
3. get_booking_link (POST ${REST_BASE}/booking-links): a checkout link with everything filled in — the person opens it and confirms in one tap. This is the default.
4. No screen? request_booking (POST ${REST_BASE}/booking-requests): the hotel team confirms and sends a link.
5. With a hotel's API key ("book" scope): create_booking (POST ${REST_BASE}/bookings) makes a confirmed booking, paid at the hotel.

Always read back the hotel, room, dates, guests and total and get a clear yes before request_booking or create_booking. Quote prices only from tool results. Questions about a hotel: ask_hotel. Existing bookings: find_booking (code + last name).

## Limits

${limitsText()}

## Optional

- [Hotel directory](${u.directory})
- Contact: ${PRODUCT_SUPPORT_EMAIL}
`;
}

/** A JSON Schema's properties as a markdown list. */
function argsList(schema: JsonSchema): string {
  const { properties = {}, required = [] } = schema as { properties?: Record<string, JsonSchema & { description?: string; default?: unknown }>; required?: string[] };
  const entries = Object.entries(properties);
  if (!entries.length) return '  - (no arguments)';
  return entries
    .map(([name, p]) => {
      const type = Array.isArray(p.type) ? (p.type as string[]).join(' | ') : (p.type as string | undefined) ?? 'object';
      const flags = [required.includes(name) ? 'required' : 'optional', p.default !== undefined ? `default ${JSON.stringify(p.default)}` : ''].filter(Boolean).join(', ');
      const nested = p.type === 'object' && p.properties ? `\n${argsList(p).replace(/^/gm, '  ')}` : '';
      return `  - \`${name}\` (${type}, ${flags})${p.description ? ` — ${p.description}` : ''}${nested}`;
    })
    .join('\n');
}

const REST_FOR: Record<string, string> = {
  search_hotels: `GET ${REST_BASE}/hotels?location=…&checkIn=…&checkOut=…&guests=…&rooms=…`,
  get_hotel: `GET ${REST_BASE}/hotels/{propertyId}`,
  check_availability: `GET ${REST_BASE}/hotels/{propertyId}/availability?checkIn=…&checkOut=…&guests=…&rooms=…`,
  get_booking_link: `POST ${REST_BASE}/booking-links (JSON body)`,
  request_booking: `POST ${REST_BASE}/booking-requests (JSON body) → 201`,
  create_booking: `POST ${REST_BASE}/bookings (JSON body, Authorization: Bearer ho_live_…) → 201`,
  find_booking: `GET ${REST_BASE}/bookings/{code}?lastName=… (404 when nothing matches)`,
  ask_hotel: `GET ${REST_BASE}/hotels/{propertyId}/answers?question=…`,
};

/** /llms-full.txt — every tool with its arguments, and the protocol details. */
export function llmsFullTxt(origin: string): string {
  const u = agentUrls(origin);
  const checkIn = addDaysISO(hotelToday(), 28);
  const checkOut = addDaysISO(checkIn, 2);
  const tools = toolCatalog()
    .map(
      (t) => `### ${t.name} — ${t.title}${t.needsKey ? ' (API key with the "book" scope)' : ''}

${t.description}

- REST: ${REST_FOR[t.name]}
- Hints: ${t.annotations.readOnlyHint ? 'read-only' : 'changes something (needs the person’s clear yes)'}
- Arguments:
${argsList(t.inputSchema)}`,
    )
    .join('\n\n');
  return `${llmsTxt(origin).trimEnd()}

---

# Details

## MCP server

- Endpoint: ${u.mcp} (all hotels) or ${u.hotelMcpTemplate} (one hotel: no search_hotels, no propertyId argument; ask_hotel lists that hotel's topics).
- Transport: Streamable HTTP, stateless. POST one JSON-RPC 2.0 message (or a batch) with \`Content-Type: application/json\`; answers are \`application/json\`. Notifications get 202. No SSE stream and no Mcp-Session-Id — GET returns 405.
- Protocol versions: ${MCP_PROTOCOL_VERSIONS.join(', ')} (initialize negotiates; latest ${MCP_LATEST_VERSION}). Server ${PRODUCT_NAME} ${MCP_SERVER_VERSION}.
- Methods: initialize, notifications/initialized, ping, tools/list, tools/call.
- Tool results carry \`structuredContent\` (the JSON result) and the same JSON as text; failures come back with \`isError: true\` and a message to relay.
- Errors: -32700 parse error, -32600 invalid request, -32601 unknown method, -32602 invalid params or unknown tool, -32001 bad API key (HTTP 401), -32003 origin not allowed (403), -32004 unknown hotel (404), -32029 rate limited (429).
- CORS is open to https sites (browser-based clients); server-to-server calls need no Origin.

## Authentication

Searching, details, availability, answers, booking links, booking requests and lookups are public. create_booking needs \`Authorization: Bearer ho_live_…\` — a key the hotel owner creates in the ${PRODUCT_NAME} console (AI assistants). A key for one hotel books only there. A bad or revoked key gets HTTP 401 on every call (it never silently falls back to public access).

## REST API

Base: ${u.rest} · OpenAPI 3.1 (${API_VERSION}): ${u.openapi}
Errors are JSON: \`{ "error": "…", "message": "…", "code": "…", "details": {…} }\` with the matching HTTP status (400 rules and validation, 401/403 keys, 404 unknown hotel or booking, 409 just sold out, 429 rate limited).

## Conventions

- Dates YYYY-MM-DD (hotel time); stays up to 30 nights; 1–16 guests; 1–9 rooms.
- Money is USD numbers; \`total\` is the whole stay for all rooms; nightly prices are per room.
- Booking links don't hold the room; the price is confirmed at checkout.
- Free cancellation and date changes until 3:00 PM (hotel time) the day before arrival. Check-in from 3:00 PM, check-out by 11:00 AM.

## Tools

${tools}

## Example requests from people

${EXAMPLES.map((e) => `- "${e}"`).join('\n')}

## Example MCP call

\`\`\`http
POST ${u.mcp}
Content-Type: application/json
Accept: application/json, text/event-stream

{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_hotels","arguments":{"location":"Santa Cruz, CA","checkIn":"${checkIn}","checkOut":"${checkOut}","guests":2}}}
\`\`\`
`;
}

/**
 * /.well-known/agent-card.json — an A2A-style agent card. HotelOne speaks
 * MCP and REST rather than A2A messaging, so the card points `url` at the
 * MCP endpoint, lists both interfaces in `additionalInterfaces` (transport
 * "MCP" and "HTTP+JSON") and describes the MCP endpoint in the
 * `capabilities.extensions` entry for Streamable HTTP.
 */
export function agentCard(origin: string) {
  const u = agentUrls(origin);
  const tags: Record<string, string[]> = {
    search_hotels: ['search', 'hotels', 'availability'],
    get_hotel: ['hotel', 'details'],
    check_availability: ['availability', 'prices'],
    get_booking_link: ['booking', 'checkout'],
    request_booking: ['booking', 'request'],
    create_booking: ['booking', 'api-key'],
    find_booking: ['booking', 'lookup'],
    ask_hotel: ['faq', 'questions'],
  };
  return {
    protocolVersion: '0.3.0',
    name: PRODUCT_NAME,
    description: `Search and book independent hotels, inns and motels on ${PRODUCT_NAME}: live availability and prices, guests' questions answered from each hotel's own information, pre-filled booking links the guest confirms in one tap, booking requests the hotel confirms, and confirmed pay-at-hotel bookings for API key holders.`,
    url: u.mcp,
    preferredTransport: 'MCP',
    additionalInterfaces: [
      { url: u.mcp, transport: 'MCP' },
      { url: u.rest, transport: 'HTTP+JSON' },
    ],
    provider: { organization: PRODUCT_NAME, url: PRODUCT_URL },
    version: MCP_SERVER_VERSION,
    iconUrl: `${origin}/icon.svg`,
    documentationUrl: u.page,
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: false,
      extensions: [
        {
          uri: 'https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#streamable-http',
          description: 'MCP server over Streamable HTTP (stateless JSON responses).',
          required: false,
          params: { endpoint: u.mcp, hotelEndpointTemplate: u.hotelMcpTemplate, protocolVersions: [...MCP_PROTOCOL_VERSIONS], openapi: u.openapi, llms: u.llms },
        },
      ],
    },
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'ho_live_…', description: 'Only for create_booking. Hotel owners create keys in the console.' },
    },
    security: [],
    defaultInputModes: ['application/json', 'text/plain'],
    defaultOutputModes: ['application/json'],
    skills: toolCatalog().map((t) => ({
      id: t.name,
      name: t.title,
      description: t.description,
      tags: tags[t.name] ?? [],
      ...(t.name === 'search_hotels' ? { examples: [EXAMPLES[0], EXAMPLES[2]] } : t.name === 'ask_hotel' ? { examples: [EXAMPLES[1]] } : t.name === 'find_booking' ? { examples: [EXAMPLES[3]] } : {}),
      inputModes: ['application/json'],
      outputModes: ['application/json'],
    })),
    supportsAuthenticatedExtendedCard: false,
  };
}

/** /.well-known/mcp.json — where the MCP server is and how to talk to it. */
export function mcpManifest(origin: string) {
  const u = agentUrls(origin);
  return {
    name: PRODUCT_NAME,
    title: `${PRODUCT_NAME} — find and book hotels`,
    description: 'Search independent hotels, check live availability and prices, answer guests’ questions and book.',
    version: MCP_SERVER_VERSION,
    websiteUrl: u.page,
    servers: [
      {
        name: PRODUCT_NAME,
        description: 'All hotels.',
        url: u.mcp,
        transport: 'streamable-http',
        protocolVersions: [...MCP_PROTOCOL_VERSIONS],
        stateless: true,
        authentication: { required: false, optional: { type: 'bearer', format: 'ho_live_…', unlocks: ['create_booking'] } },
      },
      {
        name: `${PRODUCT_NAME} (one hotel)`,
        description: 'One hotel’s own server: no cross-hotel search; every call is about that hotel.',
        urlTemplate: u.hotelMcpTemplate,
        transport: 'streamable-http',
        protocolVersions: [...MCP_PROTOCOL_VERSIONS],
        stateless: true,
      },
    ],
    tools: toolCatalog().map((t) => ({ name: t.name, title: t.title, requiresApiKey: t.needsKey })),
    documentation: { llms: u.llms, llmsFull: u.llmsFull, openapi: u.openapi, agentCard: u.agentCard },
    contact: PRODUCT_SUPPORT_EMAIL,
  };
}
