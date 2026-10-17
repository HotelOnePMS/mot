/**
 * Signed action plans. Write actions are never executed when the agent
 * proposes them: the server returns a plan whose steps are HMAC-signed, the
 * person reviews it, and only a valid, unexpired, unreplayed token for the
 * same user can be executed.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { prisma } from '@/lib/prisma';
import { badRequest, forbidden } from '../errors';

export interface PlanStep {
  tool: string;
  args: Record<string, unknown>;
  summary: string;
  detail?: string;
}

export interface SignedPlanPayload {
  v: 1;
  uid: string;
  pid: string;
  nonce: string;
  exp: number;
  title: string;
  steps: PlanStep[];
  /** The command's normalised shape, logged as `okShape` when the plan runs (shortcut suggestions). */
  shape?: { shape: string; template: string };
}

const TTL_MS = 10 * 60 * 1000;

function secret(): string {
  const s = process.env.AGENT_PLAN_SECRET || process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET;
  if (!s) throw new Error('NEXTAUTH_SECRET (or AGENT_PLAN_SECRET) must be set to sign agent plans.');
  return s;
}

const b64url = (buf: Buffer) => buf.toString('base64url');

export function signPlan(input: { userId: string; propertyId: string; title: string; steps: PlanStep[]; shape?: { shape: string; template: string } }): { token: string; expiresAt: string } {
  const payload: SignedPlanPayload = {
    v: 1,
    uid: input.userId,
    pid: input.propertyId,
    nonce: b64url(randomBytes(12)),
    exp: Date.now() + TTL_MS,
    title: input.title,
    steps: input.steps,
    ...(input.shape ? { shape: { shape: input.shape.shape.slice(0, 300), template: input.shape.template.slice(0, 300) } } : {}),
  };
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = b64url(createHmac('sha256', secret()).update(body).digest());
  return { token: `${body}.${sig}`, expiresAt: new Date(payload.exp).toISOString() };
}

export function verifyPlan(token: string, userId: string): SignedPlanPayload {
  const [body, sig] = token.split('.');
  if (!body || !sig) throw badRequest('This confirmation is malformed. Ask again.');
  const expected = createHmac('sha256', secret()).update(body).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw forbidden('This confirmation could not be verified. Ask the agent again.');
  }
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SignedPlanPayload;
  if (payload.v !== 1) throw badRequest('Unsupported plan version.');
  if (payload.uid !== userId) throw forbidden('This plan was prepared for someone else.');
  if (Date.now() > payload.exp) throw badRequest('This plan expired. Ask again so it reflects the latest data.');
  return payload;
}

/**
 * Claims a plan before any step runs (double-click / replay protection).
 * The nonce is the primary key, so of two concurrent confirms — even on
 * different server instances — exactly one wins. False when already claimed.
 */
export async function claimPlan(propertyId: string, nonce: string, userId: string): Promise<boolean> {
  try {
    await prisma.executedPlan.create({ data: { nonce, propertyId, userId } });
    return true;
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') return false;
    throw e;
  }
}
