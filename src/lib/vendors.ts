/**
 * Vendor categories and the shape of a vendor. Client-safe: the Vendors page and the server share them.
 */

export const VENDOR_CATEGORIES = [
  { id: 'SUPPLIES', label: 'Supplies & amenities' },
  { id: 'FOOD_BEVERAGE', label: 'Food & beverage' },
  { id: 'LINEN_LAUNDRY', label: 'Linen & laundry' },
  { id: 'CLEANING', label: 'Cleaning & chemicals' },
  { id: 'MAINTENANCE', label: 'Maintenance & repairs' },
  { id: 'TECHNOLOGY', label: 'Technology & IT' },
  { id: 'UTILITIES', label: 'Utilities' },
  { id: 'SECURITY', label: 'Security' },
  { id: 'MARKETING', label: 'Marketing & sales' },
  { id: 'PROFESSIONAL', label: 'Professional services' },
  { id: 'OTHER', label: 'Other' },
] as const;

export type VendorCategory = (typeof VENDOR_CATEGORIES)[number]['id'];
export const VENDOR_CATEGORY_IDS = VENDOR_CATEGORIES.map((c) => c.id) as [VendorCategory, ...VendorCategory[]];

export function vendorCategoryLabel(id: string): string {
  return VENDOR_CATEGORIES.find((c) => c.id === id)?.label ?? 'Other';
}

export type VendorStatus = 'ACTIVE' | 'INACTIVE';

/** One supplier or service partner of a hotel. */
export interface VendorEntry {
  id: string;
  propertyId: string;
  name: string;
  category: VendorCategory;
  services: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  address: string | null;
  accountNumber: string | null;
  notes: string | null;
  preferred: boolean;
  status: VendorStatus;
  createdAt: string;
  updatedAt: string;
  createdBy: { id: string; name: string };
}

/** The editable fields, as the Add/Edit form sends them. */
export interface VendorInput {
  name: string;
  category: VendorCategory;
  services?: string | null;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  address?: string | null;
  accountNumber?: string | null;
  notes?: string | null;
  preferred?: boolean;
  status?: VendorStatus;
}

/** A website as typed ("acme.com") made into a link, or null when it isn't one. */
export function normalizeWebsite(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim();
  if (!v) return null;
  const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  try {
    const u = new URL(withScheme);
    if (!u.hostname.includes('.')) return null;
    return u.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}
