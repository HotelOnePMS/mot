import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));

import { clientIp } from '@/server/http';
import { checkDomainWithHosting, getDnsInstructions, isHostingManaged } from '@/server/domains';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const request = (headers: Record<string, string>) => new Request('https://hotelone.site/api/x', { headers });

describe('clientIp on Cloudflare', () => {
  it('trusts CF-Connecting-IP only when HOSTING=cloudflare', () => {
    const req = request({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '198.51.100.1' });
    expect(clientIp(req)).toBe('198.51.100.1');
    vi.stubEnv('HOSTING', 'cloudflare');
    expect(clientIp(req)).toBe('203.0.113.7');
  });
});

describe('hotel domains on Cloudflare for SaaS', () => {
  it('tells owners to CNAME to the fallback origin instead of Vercel', () => {
    vi.stubEnv('CLOUDFLARE_API_TOKEN', 't');
    vi.stubEnv('CLOUDFLARE_ZONE_ID', 'z');
    vi.stubEnv('PROPERTY_DOMAIN_BASE', 'hotelone.site');
    expect(isHostingManaged()).toBe(true);
    expect(getDnsInstructions('book.mymotel.com')).toEqual([{ type: 'CNAME', name: 'book', value: 'hotels.hotelone.site' }]);
    const apex = getDnsInstructions('mymotel.com');
    expect(apex[0]).toMatchObject({ type: 'CNAME', name: '@', value: 'hotels.hotelone.site' });
    expect(apex[1]).toMatchObject({ type: 'CNAME', name: 'www', value: 'hotels.hotelone.site' });
  });

  it('keeps the Vercel targets when only Vercel is configured', () => {
    vi.stubEnv('CLOUDFLARE_API_TOKEN', '');
    vi.stubEnv('VERCEL_API_TOKEN', 't');
    vi.stubEnv('VERCEL_PROJECT_ID', 'p');
    expect(getDnsInstructions('mymotel.com')[0]).toEqual({ type: 'A', name: '@', value: '76.76.21.21' });
  });

  it('reports a pending custom hostname with its ownership TXT record', async () => {
    vi.stubEnv('CLOUDFLARE_API_TOKEN', 't');
    vi.stubEnv('CLOUDFLARE_ZONE_ID', 'zone1');
    const calls: { url: string; method: string }[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET' });
      return new Response(
        JSON.stringify({
          success: true,
          result: init?.method === 'PATCH' ? {} : [
            {
              id: 'ch1',
              hostname: 'book.mymotel.com',
              status: 'pending',
              ssl: { status: 'pending_validation' },
              ownership_verification: { type: 'txt', name: '_cf-custom-hostname.book.mymotel.com', value: 'abc' },
            },
          ],
        }),
      );
    });
    const status = await checkDomainWithHosting('book.mymotel.com');
    expect(status).toEqual({
      live: false,
      verification: [{ type: 'TXT', name: '_cf-custom-hostname.book.mymotel.com', value: 'abc', note: 'Proves you own the domain' }],
    });
    expect(calls[0].url).toBe('https://api.cloudflare.com/client/v4/zones/zone1/custom_hostnames?hostname=book.mymotel.com');
    expect(calls[1]).toEqual({ url: 'https://api.cloudflare.com/client/v4/zones/zone1/custom_hostnames/ch1', method: 'PATCH' });
  });
});
