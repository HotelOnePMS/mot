#!/usr/bin/env node
/**
 * Run by scripts/vercel-build.mjs after migrations (only with PROPERTY_DOMAIN_BASE set).
 *
 * 1. Gives every property without one a default subdomain from its name
 *    (properties created by the seed, or before the subdomain migration ran).
 * 2. With VERCEL_API_TOKEN + VERCEL_PROJECT_ID, and unless
 *    PROPERTY_DOMAIN_WILDCARD=true, adds each <subdomain>.<base> that the
 *    Vercel project doesn't have yet, which also retries any add that failed
 *    when a property was created or renamed.
 *
 * Never fails the build: problems are logged and the deploy carries on.
 * The naming rules mirror src/lib/domain-utils.ts and src/server/domains.ts.
 */
import { PrismaClient } from '@prisma/client';

const base = process.env.PROPERTY_DOMAIN_BASE?.trim().toLowerCase();
const token = process.env.VERCEL_API_TOKEN;
const projectId = process.env.VERCEL_PROJECT_ID;
const teamId = process.env.VERCEL_TEAM_ID;

const RESERVED = new Set([
  'www', 'app', 'api', 'admin', 'dashboard', 'login', 'auth', 'account', 'book', 'booking', 'bookings',
  'mail', 'email', 'smtp', 'imap', 'ftp', 'ns1', 'ns2', 'cdn', 'static', 'assets', 'media',
  'help', 'support', 'status', 'docs', 'blog', 'dev', 'staging', 'test', 'demo',
]);
const PATTERN = /^(?!xn--)[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const isValid = (s) => PATTERN.test(s) && !RESERVED.has(s);

const slugify = (name) =>
  name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 50)
    .replace(/-+$/, '');

async function vercel(path, method = 'GET', body) {
  const url = new URL(path, 'https://api.vercel.com');
  if (teamId) url.searchParams.set('teamId', teamId);
  return fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function projectDomains() {
  const names = new Set();
  let until;
  for (let page = 0; page < 50; page++) {
    const query = new URLSearchParams({ limit: '100', ...(until ? { until: String(until) } : {}) });
    const res = await vercel(`/v9/projects/${encodeURIComponent(projectId)}/domains?${query}`);
    if (!res.ok) throw new Error(`listing domains returned ${res.status}`);
    const data = await res.json();
    for (const d of data.domains ?? []) names.add(d.name);
    until = data.pagination?.next;
    if (!until) break;
  }
  return names;
}

async function main() {
  if (!base) return;
  const prisma = new PrismaClient();
  try {
    const missing = await prisma.property.findMany({ where: { subdomain: null }, select: { id: true, name: true } });
    for (const property of missing) {
      let slug = slugify(property.name);
      if (slug.length < 3) slug = slug ? `${slug}-hotel` : 'hotel';
      const candidates = [slug, ...Array.from({ length: 8 }, (_, i) => `${slug}-${i + 2}`), `${slug}-${property.id.slice(-6).toLowerCase()}`].filter(isValid);
      const taken = new Set(
        (await prisma.property.findMany({ where: { subdomain: { in: candidates } }, select: { subdomain: true } })).map((p) => p.subdomain),
      );
      const subdomain = candidates.find((c) => !taken.has(c));
      if (!subdomain) continue;
      await prisma.property.update({ where: { id: property.id }, data: { subdomain } });
      console.log(`  ${property.name}: ${subdomain}.${base}`);
    }

    if (!token || !projectId || process.env.PROPERTY_DOMAIN_WILDCARD === 'true') return;

    const existing = await projectDomains();
    const properties = await prisma.property.findMany({ where: { subdomain: { not: null } }, select: { subdomain: true } });
    let added = 0;
    for (const { subdomain } of properties) {
      const name = `${subdomain}.${base}`;
      if (existing.has(name)) continue;
      const res = await vercel(`/v10/projects/${encodeURIComponent(projectId)}/domains`, 'POST', { name });
      if (res.ok || res.status === 409) added++;
      else console.warn(`  couldn't add ${name} to Vercel (${res.status})`);
    }
    console.log(`Property subdomains: ${added} added to Vercel, ${properties.length - added} already there or skipped.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => console.warn('⚠ Property subdomain sync skipped:', error.message ?? error));
