/**
 * The hotel's front desk payment settings: the security deposit taken at
 * check-in, and the Stripe Terminal card readers on its connected account.
 * Readers are registered to one Terminal location per hotel, created on first
 * use from the hotel's address.
 */
import { prisma } from '@/lib/prisma';
import { getStripe, isStripeConfigured } from '@/lib/stripe';
import { MAX_SECURITY_DEPOSIT, type SecurityDepositMode } from '@/lib/desk-payments';
import { assertPropertyAccess, requirePermission, type Actor } from '../authz';
import { assertNotDemoHotel } from '../demo';
import { badRequest, notFound } from '../errors';
import { recordAudit, type OpContext } from '../services/audit';
import { isStripeTestMode, toReader, type DeskReader } from './desk';

export interface DeskSettings {
  securityDepositMode: SecurityDepositMode;
  securityDepositAmount: number;
  maxSecurityDeposit: number;
  currency: string;
  /** Card payments at the desk need a connected Stripe account that can take charges. */
  cardAvailable: boolean;
  readers: DeskReader[];
  testMode: boolean;
}

const select = {
  id: true,
  name: true,
  isDemo: true,
  currency: true,
  address: true,
  city: true,
  state: true,
  zipCode: true,
  stripeAccountId: true,
  stripeChargesEnabled: true,
  securityDepositMode: true,
  securityDepositAmount: true,
  stripeTerminalLocationId: true,
} as const;

async function load(actor: Actor, propertyId: string) {
  assertPropertyAccess(actor, propertyId);
  const property = await prisma.property.findUnique({ where: { id: propertyId }, select });
  if (!property) throw notFound('Property');
  return property;
}

type Property = Awaited<ReturnType<typeof load>>;

const canTakeCards = (p: Property) => isStripeConfigured() && !!p.stripeAccountId && p.stripeChargesEnabled;
const opts = (p: Property) => ({ stripeAccount: p.stripeAccountId! });

async function readersOf(p: Property): Promise<DeskReader[]> {
  if (!canTakeCards(p) || !p.stripeTerminalLocationId) return [];
  const list = await getStripe().terminal.readers.list({ location: p.stripeTerminalLocationId, limit: 50 }, opts(p));
  return list.data.map(toReader);
}

async function toSettings(p: Property): Promise<DeskSettings> {
  return {
    securityDepositMode: p.securityDepositMode,
    securityDepositAmount: Number(p.securityDepositAmount),
    maxSecurityDeposit: MAX_SECURITY_DEPOSIT,
    currency: p.currency,
    cardAvailable: canTakeCards(p),
    readers: await readersOf(p).catch((e) => {
      console.error('[payments] Could not list card readers:', e);
      return [];
    }),
    testMode: isStripeTestMode(),
  };
}

export async function getDeskSettings(actor: Actor, propertyId: string): Promise<DeskSettings> {
  requirePermission(actor, 'payments.view');
  return toSettings(await load(actor, propertyId));
}

/** PUT — the security deposit the desk takes at check-in. A card hold needs Stripe; a charge can also be taken in cash. */
export async function setDepositPolicy(op: OpContext, propertyId: string, input: { mode: SecurityDepositMode; amount: number }): Promise<DeskSettings> {
  requirePermission(op.actor, 'payments.manage');
  const p = await load(op.actor, propertyId);
  if (input.mode !== 'NONE' && !(input.amount > 0)) throw badRequest('Enter the deposit amount.');
  if (input.amount > MAX_SECURITY_DEPOSIT) throw badRequest(`A security deposit can be at most ${MAX_SECURITY_DEPOSIT.toLocaleString('en-US')} ${p.currency}.`);
  if (input.mode === 'HOLD' && !canTakeCards(p)) throw badRequest('A card hold needs the hotel’s Stripe account. Connect Stripe first, or charge the deposit (cash works without Stripe).');
  const updated = await prisma.property.update({
    where: { id: p.id },
    data: { securityDepositMode: input.mode, securityDepositAmount: input.mode === 'NONE' ? 0 : Math.round(input.amount * 100) / 100 },
    select,
  });
  await recordAudit(op, p.id, 'PAYMENTS_DEPOSIT_POLICY', `Security deposit at ${p.name}: ${input.mode === 'NONE' ? 'none' : `${input.amount.toFixed(2)} ${p.currency} (${input.mode === 'HOLD' ? 'card hold' : 'charge and refund'})`}`, {
    from: { mode: p.securityDepositMode, amount: Number(p.securityDepositAmount) },
    to: input,
  });
  return toSettings(updated);
}

/** The hotel's Terminal location, created on its connected account the first time a reader is added. */
async function ensureLocation(p: Property): Promise<string> {
  if (p.stripeTerminalLocationId) return p.stripeTerminalLocationId;
  const stripe = getStripe();
  const account = await stripe.accounts.retrieve(p.stripeAccountId!);
  const country = account.country || process.env.STRIPE_CONNECT_DEFAULT_COUNTRY || 'US';
  const location = await stripe.terminal.locations.create(
    {
      display_name: p.name.slice(0, 100),
      address: { line1: p.address, city: p.city, state: p.state, postal_code: p.zipCode, country },
      metadata: { propertyId: p.id },
    },
    { ...opts(p), idempotencyKey: `terminal-location-${p.id}` }
  );
  // Two people adding a reader at once: the first location wins, the other is unused.
  await prisma.property.updateMany({ where: { id: p.id, stripeTerminalLocationId: null }, data: { stripeTerminalLocationId: location.id } });
  const fresh = await prisma.property.findUniqueOrThrow({ where: { id: p.id }, select: { stripeTerminalLocationId: true } });
  return fresh.stripeTerminalLocationId!;
}

/**
 * POST — register a card reader (Stripe Terminal smart reader, e.g. WisePOS E
 * or S700) with the code it shows on screen. In test mode, the code
 * "simulated-wpe" adds a simulated reader.
 */
export async function registerReader(op: OpContext, propertyId: string, input: { registrationCode: string; label: string }): Promise<DeskSettings> {
  requirePermission(op.actor, 'payments.manage');
  const p = await load(op.actor, propertyId);
  assertNotDemoHotel(op.actor, p.isDemo, 'Demo hotels can’t take real payments. Set up your own hotel to add a card reader.');
  if (!canTakeCards(p)) throw badRequest('Connect the hotel’s Stripe account in Online payments before adding a card reader.');
  const code = input.registrationCode.trim();
  if (code.startsWith('simulated') && !isStripeTestMode()) throw badRequest('Simulated readers only work with Stripe test keys.');
  const location = await ensureLocation(p);
  try {
    await getStripe().terminal.readers.create({ registration_code: code, label: input.label.trim().slice(0, 100), location, metadata: { propertyId: p.id } }, opts(p));
  } catch (e) {
    throw badRequest(`Stripe couldn’t register the reader: ${e instanceof Error ? e.message : String(e)}. Check the code on the reader’s screen (Settings → Generate pairing code).`);
  }
  await recordAudit(op, p.id, 'PAYMENTS_READER_ADDED', `Card reader "${input.label.trim()}" added at ${p.name}`);
  return toSettings(p);
}

/** DELETE — remove a reader from the hotel. */
export async function removeReader(op: OpContext, propertyId: string, readerId: string): Promise<DeskSettings> {
  requirePermission(op.actor, 'payments.manage');
  const p = await load(op.actor, propertyId);
  if (!canTakeCards(p) || !p.stripeTerminalLocationId) throw badRequest('This hotel has no card readers.');
  const stripe = getStripe();
  const reader = await stripe.terminal.readers.retrieve(readerId, {}, opts(p)).catch(() => null);
  if (!reader || reader.deleted || reader.location !== p.stripeTerminalLocationId) throw badRequest('That reader isn’t registered to this hotel.');
  await stripe.terminal.readers.del(readerId, {}, opts(p));
  await recordAudit(op, p.id, 'PAYMENTS_READER_REMOVED', `Card reader "${reader.label ?? reader.id}" removed at ${p.name}`);
  return toSettings(p);
}
