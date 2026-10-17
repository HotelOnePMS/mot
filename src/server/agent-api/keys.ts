/**
 * API keys for outside AI assistants and partner integrations (Muse, Grok,
 * a travel agent's own bot…). A key identifies the integration (higher rate
 * limits, attribution on bookings) and, with the "book" scope, lets it make
 * confirmed pay-at-hotel bookings through the MCP server and the REST API.
 *
 * Format: "ho_live_" + 32 random base62 characters. Only the SHA-256 (hex)
 * is stored, with the first 12 characters as a display prefix; the full key
 * is shown once, when it's created. A key belongs to one hotel, or to every
 * hotel (propertyId null — platform admins only).
 */
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import type { AgentApiKey } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { DomainError, conflict, notFound } from '../errors';

export const AGENT_KEY_PREFIX = 'ho_live_';
/** What a key may do beyond the public tools. */
export const AGENT_KEY_SCOPES = ['book'] as const;
export type AgentKeyScope = (typeof AGENT_KEY_SCOPES)[number];
/** Characters of the key kept for display ("ho_live_AbC1"). */
export const AGENT_KEY_DISPLAY_LENGTH = 12;
/** Why keys can't be created or revoked here in the public demo (src/server/demo.ts demoHotelLocked). */
export const AGENT_KEYS_DEMO_LOCKED = 'API keys aren’t available on demo hotels or with the shared demo logins. Set up your own hotel (Get started) to connect your own assistants.';
/** Active keys a hotel (or the all-hotels pool) may hold at once. */
export const MAX_ACTIVE_KEYS = 25;

const BODY_LENGTH = 32;
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const KEY_PATTERN = /^ho_live_[0-9A-Za-z]{32}$/;
/** lastUsedAt is written at most this often per key. */
const TOUCH_EVERY_MS = 60_000;

/** A new random key: "ho_live_" + 32 base62 characters (≈190 bits). */
export function generateAgentKey(): string {
  let body = '';
  while (body.length < BODY_LENGTH) {
    // Rejection sampling keeps every character equally likely (248 = 4 × 62).
    for (const b of randomBytes(48)) if (b < 248 && body.length < BODY_LENGTH) body += ALPHABET[b % 62];
  }
  return AGENT_KEY_PREFIX + body;
}

/** SHA-256 hex of a key, as stored in agent_api_keys.keyHash. */
export const hashAgentKey = (key: string) => createHash('sha256').update(key, 'utf8').digest('hex');

/** The part of a key that's safe to show. */
export const agentKeyPrefix = (key: string) => key.slice(0, AGENT_KEY_DISPLAY_LENGTH);

/** The integration behind a verified key. */
export interface AgentKeyContext {
  id: string;
  name: string;
  /** Display prefix ("ho_live_AbC1"). */
  prefix: string;
  /** The one hotel it works for, or null for every hotel. */
  propertyId: string | null;
  scopes: string[];
}

/** True when the key may book at this hotel. */
export function keyCanBook(key: AgentKeyContext | null, propertyId: string | null): boolean {
  if (!key || !key.scopes.includes('book')) return false;
  return key.propertyId === null || propertyId === null || key.propertyId === propertyId;
}

/** Who booked, for the booking's history: "Muse (API key ho_live_AbC1…)" (≤ 80 characters). */
export function keySource(key: AgentKeyContext): string {
  const suffix = ` (API key ${key.prefix}…)`;
  const name = key.name.length + suffix.length > 80 ? `${key.name.slice(0, 79 - suffix.length)}…` : key.name;
  return name + suffix;
}

const invalidKey = (why: string) => new DomainError(401, 'INVALID_API_KEY', why);

/**
 * The key in `Authorization: Bearer <key>`, verified: null when the request
 * has no Authorization header (public access); DomainError 401
 * INVALID_API_KEY when it has one that's malformed, unknown or revoked — a
 * key that stopped working should fail loudly, not quietly lose access.
 * Looks the key up by its hash (the secret is never compared directly) and
 * records when it was last used, at most once a minute.
 */
export async function agentKeyFromRequest(request: Request): Promise<AgentKeyContext | null> {
  const header = request.headers.get('authorization');
  if (!header || !header.trim()) return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header.trim());
  if (!match) throw invalidKey('Send the API key as "Authorization: Bearer ho_live_…".');
  const key = match[1];
  if (!KEY_PATTERN.test(key)) throw invalidKey('That isn’t a HotelOne API key. Keys start with "ho_live_" — the hotel owner can create one in the HotelOne console under AI assistants.');
  const hash = hashAgentKey(key);
  const row = await prisma.agentApiKey.findUnique({ where: { keyHash: hash } });
  // The lookup is by hash; compare again in constant time so a match never depends on string comparison timing.
  if (!row || !timingSafeEqual(Buffer.from(row.keyHash, 'hex'), Buffer.from(hash, 'hex'))) throw invalidKey('This API key isn’t recognised. Check it was copied in full, or ask the hotel for a new one.');
  if (row.revokedAt) throw invalidKey('This API key was revoked. Ask the hotel for a new one.');
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > TOUCH_EVERY_MS) {
    void prisma.agentApiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch((e) => console.error('[agent-api] could not record key use', e));
  }
  return { id: row.id, name: row.name, prefix: row.prefix, propertyId: row.propertyId, scopes: row.scopes };
}

// ---------------------------------------------------------------------------
// Console: list, create, revoke
// ---------------------------------------------------------------------------

/** A key as the console shows it (never the secret or its hash). */
export interface AgentKeyView {
  id: string;
  name: string;
  /** "ho_live_AbC1" — show it followed by "…". */
  prefix: string;
  scopes: string[];
  propertyId: string | null;
  /** Works for every hotel (platform admins only). */
  allHotels: boolean;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  /** Who created it, when known. */
  createdBy: string | null;
}

async function toViews(rows: AgentApiKey[]): Promise<AgentKeyView[]> {
  const ids = [...new Set(rows.map((r) => r.createdById).filter((v): v is string => !!v))];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true } }) : [];
  const names = new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    scopes: r.scopes,
    propertyId: r.propertyId,
    allHotels: r.propertyId === null,
    createdAt: r.createdAt.toISOString(),
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
    revokedAt: r.revokedAt?.toISOString() ?? null,
    createdBy: (r.createdById && names.get(r.createdById)) || null,
  }));
}

/** A hotel's keys (and, with `includeAllHotels`, the all-hotel keys), active first, newest first. */
export async function listAgentKeys(propertyId: string, opts: { includeAllHotels?: boolean } = {}): Promise<AgentKeyView[]> {
  const rows = await prisma.agentApiKey.findMany({
    where: opts.includeAllHotels ? { OR: [{ propertyId }, { propertyId: null }] } : { propertyId },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  rows.sort((x, y) => Number(!!x.revokedAt) - Number(!!y.revokedAt));
  return toViews(rows);
}

/** One key by id, or null. */
export async function getAgentKey(id: string): Promise<AgentKeyView | null> {
  const row = await prisma.agentApiKey.findUnique({ where: { id } });
  return row ? (await toViews([row]))[0] : null;
}

/**
 * Creates a key and returns it in full — the only time it's ever available.
 * Authorisation (who may create a key for which hotel) is the caller's job.
 * DomainError 409 when the hotel already has MAX_ACTIVE_KEYS active keys.
 */
export async function createAgentKey(input: { propertyId: string | null; name: string; scopes: AgentKeyScope[]; createdById: string | null }): Promise<{ key: string; view: AgentKeyView }> {
  const active = await prisma.agentApiKey.count({ where: { propertyId: input.propertyId, revokedAt: null } });
  if (active >= MAX_ACTIVE_KEYS) throw conflict(`There are already ${MAX_ACTIVE_KEYS} active keys — revoke one you no longer use first.`);
  const key = generateAgentKey();
  const row = await prisma.agentApiKey.create({
    data: {
      propertyId: input.propertyId,
      name: input.name.trim(),
      prefix: agentKeyPrefix(key),
      keyHash: hashAgentKey(key),
      scopes: [...new Set(input.scopes)].filter((s) => (AGENT_KEY_SCOPES as readonly string[]).includes(s)),
      createdById: input.createdById,
    },
  });
  return { key, view: (await toViews([row]))[0] };
}

/** Revokes a key (it stops working at once; the row stays for the record). Revoking twice is a no-op. DomainError 404 when unknown. */
export async function revokeAgentKey(id: string): Promise<AgentKeyView> {
  const row = await prisma.agentApiKey.findUnique({ where: { id } });
  if (!row) throw notFound('API key');
  const updated = row.revokedAt ? row : await prisma.agentApiKey.update({ where: { id }, data: { revokedAt: new Date() } });
  return (await toViews([updated]))[0];
}
