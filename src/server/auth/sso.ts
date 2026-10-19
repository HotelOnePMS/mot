/**
 * Single sign-on with an organization's identity provider over OpenID
 * Connect (Okta, Microsoft Entra ID, Google Workspace, Auth0, Keycloak…;
 * SAML-only providers connect through a broker that speaks OIDC).
 *
 *   /api/sso/start     work email → the organization whose domain it is →
 *                      redirect to its provider (authorization code + PKCE,
 *                      state and nonce in a signed, short-lived cookie)
 *   /api/sso/callback  code → tokens → validated ID token → find, link or
 *                      create the person → single-use ticket → /login/sso,
 *                      which signs in through the "sso" NextAuth provider.
 *
 * People are matched by (issuer, subject); the first time, by email, and only
 * for addresses in the organization's verified SSO domains. New people get
 * the organization's default role and every one of its hotels.
 */
import { createHmac, timingSafeEqual } from 'crypto';
import * as oauth from 'oauth4webapi';
import { prisma } from '@/lib/prisma';
import { DomainError, badRequest } from '../errors';
import { assertSafeMcpUrl } from '../pms/url-guard';
import { open } from '../vault';
import { issueToken } from './tokens';

export const SSO_COOKIE = 'ho_sso';
const STATE_TTL_MS = 10 * 60_000;

export const ssoCallbackPath = '/api/sso/callback';

/** The issuer must be a public https address (it is fetched by our server). */
export async function assertSafeIssuer(issuer: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(issuer);
  } catch {
    throw badRequest('The issuer must be a full URL, like https://yourcompany.okta.com');
  }
  if (url.protocol !== 'https:' && process.env.NODE_ENV === 'production') throw badRequest('The issuer must use https://');
  try {
    await assertSafeMcpUrl(url.toString());
  } catch (e) {
    throw badRequest(`That issuer can’t be used: ${(e as Error).message.replace(/MCP address/g, 'issuer')}`);
  }
  return url;
}

const discovered = new Map<string, { at: number; as: oauth.AuthorizationServer }>();

async function authorizationServer(issuer: string): Promise<oauth.AuthorizationServer> {
  const hit = discovered.get(issuer);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.as;
  const url = await assertSafeIssuer(issuer);
  const options = { algorithm: 'oidc' as const, signal: AbortSignal.timeout(10_000), ...(url.protocol === 'http:' ? { [oauth.allowInsecureRequests]: true } : {}) };
  let as: oauth.AuthorizationServer;
  try {
    as = await oauth.processDiscoveryResponse(url, await oauth.discoveryRequest(url, options));
  } catch (e) {
    throw new DomainError(502, 'SSO_DISCOVERY', `Couldn’t read the identity provider’s configuration at ${url.origin}: ${(e as Error).message}`);
  }
  if (!as.authorization_endpoint || !as.token_endpoint) throw new DomainError(502, 'SSO_DISCOVERY', 'The identity provider didn’t publish its sign-in endpoints.');
  discovered.set(issuer, { at: Date.now(), as });
  return as;
}

/** Check the provider's discovery document (Organization → Single sign-on → Test). */
export async function testIssuer(issuer: string): Promise<{ issuer: string; authorization: string }> {
  const as = await authorizationServer(issuer.replace(/\/$/, ''));
  return { issuer: as.issuer, authorization: as.authorization_endpoint! };
}

// ---------------------------------------------------------------------------
// Signed state cookie
// ---------------------------------------------------------------------------

interface SsoState {
  o: string; // organization id
  s: string; // state
  n: string; // nonce
  v: string; // PKCE verifier
  c: string; // callback URL after sign-in
  e: number; // expiry (ms)
}

function stateKey(): string {
  const s = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error('NEXTAUTH_SECRET must be set for single sign-on.');
  return createHmac('sha256', s).update('hotelone-sso-state-v1').digest('hex');
}

export function sealState(state: SsoState): string {
  const body = Buffer.from(JSON.stringify(state)).toString('base64url');
  const sig = createHmac('sha256', stateKey()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function openState(raw: string | undefined): SsoState | null {
  if (!raw) return null;
  const [body, sig] = raw.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', stateKey()).update(body).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const state = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SsoState;
    return state.e > Date.now() ? state : null;
  } catch {
    return null;
  }
}

/** Only same-site paths are followed after sign-in. */
export function safeCallbackUrl(raw: string | null | undefined): string {
  return raw && raw.startsWith('/') && !raw.startsWith('//') && !raw.startsWith('/\\') ? raw.slice(0, 500) : '/admin';
}

// ---------------------------------------------------------------------------
// Flow
// ---------------------------------------------------------------------------

/** The organization that signs this email in through SSO, if any. */
export async function ssoOrganizationFor(email: string) {
  const domain = email.trim().toLowerCase().split('@')[1];
  if (!domain) return null;
  return prisma.organization.findFirst({ where: { ssoEnabled: true, ssoDomains: { has: domain } } });
}

function clientFor(org: { ssoClientId: string | null }): oauth.Client {
  return { client_id: org.ssoClientId! };
}

export async function startSso(input: { email: string; callbackUrl?: string | null; origin: string }): Promise<{ redirect: string; cookie: string }> {
  const org = await ssoOrganizationFor(input.email);
  if (!org || !org.ssoIssuer || !org.ssoClientId) throw new DomainError(404, 'SSO_NOT_FOUND', 'Single sign-on isn’t set up for that email address. Sign in with your password instead.');
  const as = await authorizationServer(org.ssoIssuer);
  const verifier = oauth.generateRandomCodeVerifier();
  const state = oauth.generateRandomState();
  const nonce = oauth.generateRandomNonce();
  const url = new URL(as.authorization_endpoint!);
  url.searchParams.set('client_id', org.ssoClientId);
  url.searchParams.set('redirect_uri', `${input.origin}${ssoCallbackPath}`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);
  url.searchParams.set('code_challenge', await oauth.calculatePKCECodeChallenge(verifier));
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('login_hint', input.email.trim());
  const cookie = sealState({ o: org.id, s: state, n: nonce, v: verifier, c: safeCallbackUrl(input.callbackUrl), e: Date.now() + STATE_TTL_MS });
  return { redirect: url.toString(), cookie };
}

/** Finish the flow: returns a single-use sign-in ticket for /login/sso. */
export async function finishSso(input: { url: URL; cookie: string | undefined; origin: string }): Promise<{ ticket: string; callbackUrl: string }> {
  const state = openState(input.cookie);
  if (!state) throw new DomainError(400, 'SSO_STATE', 'Your sign-in took too long or was started in another browser. Please try again.');
  const org = await prisma.organization.findUnique({ where: { id: state.o } });
  if (!org?.ssoEnabled || !org.ssoIssuer || !org.ssoClientId || !org.ssoClientSecretCipher) {
    throw new DomainError(400, 'SSO_OFF', 'Single sign-on was turned off for your organization.');
  }
  const as = await authorizationServer(org.ssoIssuer);
  const client = clientFor(org);
  let params: URLSearchParams;
  try {
    params = oauth.validateAuthResponse(as, client, input.url, state.s);
  } catch (e) {
    throw new DomainError(400, 'SSO_DENIED', `The identity provider didn’t sign you in: ${(e as Error).message}`);
  }
  const secret = open<string>(org.ssoClientSecretCipher, `sso:${org.id}`);
  let claims: oauth.IDToken | undefined;
  try {
    const response = await oauth.authorizationCodeGrantRequest(as, client, oauth.ClientSecretBasic(secret), params, `${input.origin}${ssoCallbackPath}`, state.v, {
      signal: AbortSignal.timeout(10_000),
    });
    const result = await oauth.processAuthorizationCodeResponse(as, client, response, { expectedNonce: state.n, requireIdToken: true });
    claims = oauth.getValidatedIdTokenClaims(result);
  } catch (e) {
    throw new DomainError(502, 'SSO_TOKEN', `The identity provider’s answer couldn’t be verified: ${(e as Error).message}`);
  }
  if (!claims?.sub) throw new DomainError(502, 'SSO_TOKEN', 'The identity provider didn’t say who you are.');

  const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
  if (!email) throw new DomainError(400, 'SSO_EMAIL', 'Your identity provider didn’t share your email address. Ask your administrator to add the “email” claim.');
  if (claims.email_verified === false) throw new DomainError(400, 'SSO_EMAIL', 'Your identity provider says your email address isn’t verified.');
  const domain = email.split('@')[1];
  if (!org.ssoDomains.includes(domain)) throw new DomainError(403, 'SSO_DOMAIN', `${domain} isn’t one of ${org.name}’s sign-in domains.`);

  const userId = await provisionSsoUser(org, { issuer: org.ssoIssuer, subject: claims.sub, email, claims });
  return { ticket: await issueToken(userId, 'SSO_TICKET'), callbackUrl: state.c };
}

type OrgForProvisioning = { id: string; name: string; defaultRole: import('@prisma/client').UserRole };

/** Find, link or create the person the identity provider vouched for, and make them an organization member. */
export async function provisionSsoUser(
  org: OrgForProvisioning,
  who: { issuer: string; subject: string; email: string; claims?: Record<string, unknown> },
): Promise<string> {
  const now = new Date();
  let user = await prisma.user.findUnique({ where: { ssoIssuer_ssoSubject: { ssoIssuer: who.issuer, ssoSubject: who.subject } } });
  let created = false;
  if (!user) {
    const byEmail = await prisma.user.findFirst({ where: { email: { equals: who.email, mode: 'insensitive' } } });
    if (byEmail) {
      if (byEmail.ssoIssuer && byEmail.ssoSubject && (byEmail.ssoIssuer !== who.issuer || byEmail.ssoSubject !== who.subject)) {
        throw new DomainError(409, 'SSO_LINKED', 'This email address is already linked to another identity. Ask your administrator.');
      }
      user = await prisma.user.update({ where: { id: byEmail.id }, data: { ssoIssuer: who.issuer, ssoSubject: who.subject, emailVerifiedAt: byEmail.emailVerifiedAt ?? now } });
    } else {
      const given = typeof who.claims?.given_name === 'string' ? who.claims.given_name : '';
      const family = typeof who.claims?.family_name === 'string' ? who.claims.family_name : '';
      const full = typeof who.claims?.name === 'string' ? who.claims.name : '';
      const [first, ...rest] = (full || who.email.split('@')[0]).split(' ');
      user = await prisma.user.create({
        data: {
          email: who.email,
          password: '', // SSO only
          firstName: (given || first || 'Team').slice(0, 60),
          lastName: (family || rest.join(' ') || 'Member').slice(0, 60),
          role: org.defaultRole,
          isActive: true,
          emailVerifiedAt: now,
          ssoIssuer: who.issuer,
          ssoSubject: who.subject,
        },
      });
      created = true;
    }
  }
  if (!user.isActive) throw new DomainError(403, 'SSO_INACTIVE', 'Your account is turned off. Ask your administrator.');
  await prisma.organizationMember.upsert({
    where: { organizationId_userId: { organizationId: org.id, userId: user.id } },
    create: { organizationId: org.id, userId: user.id, role: 'MEMBER' },
    update: {},
  });
  if (created) await assignOrgHotels(org.id, user.id);
  return user.id;
}

/** New people from SSO or SCIM can work at every hotel in the organization (owners narrow it on the Team page). */
export async function assignOrgHotels(organizationId: string, userId: string): Promise<void> {
  const hotels = await prisma.property.findMany({ where: { organizationId }, select: { id: true } });
  if (hotels.length) {
    await prisma.userPropertyAssignment.createMany({ data: hotels.map((h) => ({ userId, propertyId: h.id })), skipDuplicates: true });
  }
}
