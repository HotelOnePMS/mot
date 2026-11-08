import { describe, expect, it } from 'vitest';
import { normalizeWebsite, vendorCategoryLabel } from '@/lib/vendors';
import { navFor } from '@/components/console/nav';
import { GRANTABLE_PERMISSIONS, PERMISSIONS } from '@/server/authz';

describe('vendors', () => {
  it('makes typed websites into links', () => {
    expect(normalizeWebsite('acme.com')).toBe('https://acme.com');
    expect(normalizeWebsite('http://acme.com/orders/')).toBe('http://acme.com/orders');
    expect(normalizeWebsite('  ')).toBeNull();
    expect(normalizeWebsite('not a site')).toBeNull();
    expect(vendorCategoryLabel('LINEN_LAUNDRY')).toBe('Linen & laundry');
  });

  it('is owner-only by default; only managers can be given managing', () => {
    expect(PERMISSIONS['vendors.view']).toEqual(['ADMIN', 'OWNER']);
    expect(PERMISSIONS['vendors.manage']).toEqual(['ADMIN', 'OWNER']);
    expect(GRANTABLE_PERMISSIONS['vendors.manage'].roles).toEqual(['MANAGER']);
    expect(GRANTABLE_PERMISSIONS['vendors.view'].roles).toEqual(['MANAGER', 'FRONT_DESK', 'HOUSEKEEPER']);
  });

  it('shows Vendors in the sidebar only to people allowed at the hotel', () => {
    const has = (perms: string[]) =>
      navFor('FRONT_DESK', { agentEnabled: false, can: (p) => perms.includes(p) })
        .flatMap((g) => g.items)
        .some((i) => i.href === '/admin/vendors');
    expect(has([])).toBe(false);
    expect(has(['vendors.view'])).toBe(true);
  });
});
