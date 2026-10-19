import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getPropertySubdomain, normalizeDomain, toggleWww } from '@/lib/domain-utils';

/**
 * GET — which property's booking page a host serves (asked by middleware, which
 * can't use Prisma). The host is either the property's default subdomain or its
 * own verified domain.
 */
export async function GET(request: NextRequest) {
  try {
    const domain = normalizeDomain(request.nextUrl.searchParams.get('host') || '');
    if (!domain) return NextResponse.json({ propertyId: null }, { status: 404 });

    const subdomain = getPropertySubdomain(domain);
    const property = await prisma.property.findFirst({
      where: subdomain
        ? { subdomain, isActive: true }
        : { customDomain: { in: [domain, toggleWww(domain)] }, customDomainVerified: true, isActive: true },
      select: { id: true, customDomain: true, customDomainVerified: true },
    });

    if (!property) return NextResponse.json({ propertyId: null }, { status: 404 });

    return NextResponse.json({
      propertyId: property.id,
      // Where the default subdomain sends guests once the property's own domain is live
      customDomain: property.customDomainVerified ? property.customDomain : null,
    });
  } catch (error) {
    console.error('Error resolving property domain:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
