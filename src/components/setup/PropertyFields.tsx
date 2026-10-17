'use client';

import * as React from 'react';
import { Check, Pipette } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { brandScope } from '@/components/guest/brand';
import { ChipInput } from './ChipInput';

export interface PropertyDraft {
  name: string;
  type: string;
  tagline: string;
  description: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  phone: string;
  email: string;
  amenities: string[];
  primaryColor: string;
}

export const EMPTY_PROPERTY: PropertyDraft = {
  name: '',
  type: 'Hotel',
  tagline: '',
  description: '',
  address: '',
  city: '',
  state: '',
  zipCode: '',
  phone: '',
  email: '',
  amenities: [],
  primaryColor: '#0E7490',
};

export const PROPERTY_TYPES = ['Hotel', 'Motel', 'Inn', 'B&B', 'Boutique', 'Other'];
export const BRAND_SWATCHES = ['#0E7490', '#1D4ED8', '#7C3AED', '#BE185D', '#B45309', '#15803D', '#0F172A', '#9F1239'];
const PROPERTY_AMENITIES = ['Free Wi-Fi', 'Parking', 'Pool', 'Breakfast', 'Fitness center', 'Spa', 'Restaurant', 'Bar', 'Pet friendly', 'Beach access', 'EV charging', 'Airport shuttle'];
const FALLBACK = '#0E7490';

export function toPropertyPayload(d: PropertyDraft) {
  return {
    name: d.name.trim(),
    type: d.type || 'Hotel',
    tagline: d.tagline.trim() || null,
    description: d.description.trim() || null,
    address: d.address.trim(),
    city: d.city.trim(),
    state: d.state.trim(),
    zipCode: d.zipCode.trim(),
    phone: d.phone.trim(),
    email: d.email.trim() || null,
    amenities: d.amenities,
    primaryColor: d.primaryColor || null,
  };
}

export type PropertyErrors = Partial<Record<keyof PropertyDraft, string>>;

/** Every problem with the draft, keyed by field, so each one shows next to its field. */
export function propertyErrors(d: PropertyDraft): PropertyErrors {
  const e: PropertyErrors = {};
  if (d.name.trim().length < 2) e.name = 'Add your property’s name.';
  if (d.address.trim().length < 3) e.address = 'Add the street address — guests use it to find you.';
  if (!d.city.trim()) e.city = 'Add the city.';
  if (!d.state.trim()) e.state = 'Add the state or region.';
  if (d.zipCode.trim().length < 2) e.zipCode = 'Add the postal code.';
  if (d.phone.trim().length < 5) e.phone = 'Add a phone number guests can call.';
  if (d.email.trim() && !/^\S+@\S+\.\S+$/.test(d.email.trim())) e.email = 'That email address doesn’t look right.';
  if (d.primaryColor && !/^#[0-9a-fA-F]{6}$/.test(d.primaryColor)) e.primaryColor = 'Brand color must be a hex value like #0E7490.';
  return e;
}

/** The first problem with the draft as one sentence, or null when it's ready to save. */
export function validateProperty(d: PropertyDraft): string | null {
  const e = propertyErrors(d);
  if (e.name) return e.name;
  if (e.address || e.city || e.state || e.zipCode) return 'Complete the address — guests use it to find you.';
  return e.phone ?? e.email ?? e.primaryColor ?? null;
}

/** How many fields need fixing, as a sentence for a form-level summary. */
export function errorSummary(errors: Record<string, string | undefined>): string | null {
  const n = Object.values(errors).filter(Boolean).length;
  return n === 0 ? null : n === 1 ? 'One field needs your attention — it’s marked in red.' : `${n} fields need your attention — they’re marked in red.`;
}

const isHex = (v: string) => /^#[0-9a-fA-F]{6}$/.test(v);

/** Black or white, whichever reads better on a hex colour (WCAG relative luminance). */
function readableOn(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return (1.05 / (l + 0.05)) >= ((l + 0.05) / 0.05) ? '#FFFFFF' : '#111827';
}

export function BrandColorPicker({ value, onChange, name }: { value: string; onChange: (v: string) => void; name?: string }) {
  const valid = isHex(value);
  const color = valid ? value : FALLBACK;
  const preview = brandScope(color);
  const hexId = React.useId();
  return (
    <div className="grid gap-5 sm:grid-cols-[1fr_auto] sm:items-start">
      <div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Suggested brand colors">
          {BRAND_SWATCHES.map((c) => {
            const on = value.toLowerCase() === c.toLowerCase();
            return (
              <button
                key={c}
                type="button"
                onClick={() => onChange(c)}
                aria-pressed={on}
                className={cn(
                  // The inset hairline keeps dark swatches visible on a dark card.
                  'flex size-10 items-center justify-center rounded-full shadow-[inset_0_0_0_1px_hsl(var(--foreground)/0.16)] ring-offset-2 ring-offset-card transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:hover:scale-100',
                  on && 'ring-2 ring-foreground/50'
                )}
                style={{ backgroundColor: c, color: readableOn(c) }}
                aria-label={`Use ${c}`}
              >
                {on && <Check className="size-4" aria-hidden />}
              </button>
            );
          })}
          <label
            className="relative flex size-10 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-dashed border-border-strong text-muted-foreground transition-colors hover:border-primary hover:text-primary has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-card"
            title="Pick any color"
          >
            <input type="color" value={color} onChange={(e) => onChange(e.target.value.toUpperCase())} className="absolute inset-0 cursor-pointer opacity-0" aria-label="Pick any color" />
            <Pipette className="size-4" aria-hidden />
          </label>
        </div>
        <div className="mt-4 grid max-w-[12rem] gap-1.5">
          <label htmlFor={hexId} className="text-xs font-medium text-muted-foreground">
            Hex code
          </label>
          <Input
            id={hexId}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="font-mono uppercase"
            maxLength={7}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={value && !valid ? true : undefined}
            aria-describedby={value && !valid ? `${hexId}-err` : undefined}
          />
          {value && !valid && (
            <p id={`${hexId}-err`} className="text-xs font-medium text-destructive">
              Use six digits after #, like #0E7490.
            </p>
          )}
        </div>
      </div>
      {/* Live preview of the guest booking page accent */}
      {/* Same AA-adjusted brand palette the guest pages use, so the preview reads in either console theme. */}
      <div className={cn('w-full rounded-xl border bg-surface p-4 shadow-xs sm:w-60', preview.className)} style={preview.style} aria-label="Preview of your booking page" role="img">
        <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground" aria-hidden>
          Preview
        </p>
        <p className="mt-1 truncate font-display text-lg text-foreground" aria-hidden>
          {name || 'Your hotel'}
        </p>
        <div className="mt-3 flex items-center gap-3" aria-hidden>
          <span className="rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-brand-foreground shadow-xs">Book now</span>
          <span className="text-sm font-semibold text-brand">$189 / night</span>
        </div>
      </div>
    </div>
  );
}

function Group({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

/**
 * The property form. Pass `errors` (from `propertyErrors`) to show each
 * problem next to its field; leave it out until the person tries to save.
 */
export function PropertyFields({ value, onChange, errors = {} }: { value: PropertyDraft; onChange: (v: PropertyDraft) => void; errors?: PropertyErrors }) {
  const set = <K extends keyof PropertyDraft>(k: K, v: PropertyDraft[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="space-y-10">
      <Group title="The basics" description="What guests see first on your booking page.">
        <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
          <Field label="Property name" required error={errors.name}>
            <Input value={value.name} onChange={(e) => set('name', e.target.value)} placeholder="The Saltwater Inn" maxLength={120} required autoComplete="organization" />
          </Field>
          <Field label="Type">
            <Select value={value.type} onValueChange={(v) => set('type', v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROPERTY_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <Field label="Tagline" optional hint="One line under your name on the booking page.">
          <Input value={value.tagline} onChange={(e) => set('tagline', e.target.value)} placeholder="Coastal calm, two blocks from the beach" maxLength={160} />
        </Field>
        <Field label="Description" optional hint="A short paragraph about the place: the feel, the neighborhood, what guests love.">
          <Textarea rows={4} value={value.description} onChange={(e) => set('description', e.target.value)} maxLength={4000} />
        </Field>
      </Group>

      <Group title="Location and contact" description="Shown on your booking page and in confirmation emails.">
        <Field label="Street address" required error={errors.address}>
          <Input value={value.address} onChange={(e) => set('address', e.target.value)} autoComplete="street-address" required />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="City" required error={errors.city}>
            <Input value={value.city} onChange={(e) => set('city', e.target.value)} autoComplete="address-level2" required />
          </Field>
          <Field label="State or region" required error={errors.state}>
            <Input value={value.state} onChange={(e) => set('state', e.target.value)} autoComplete="address-level1" required />
          </Field>
          <Field label="Postal code" required error={errors.zipCode}>
            <Input value={value.zipCode} onChange={(e) => set('zipCode', e.target.value)} autoComplete="postal-code" required />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Phone" required error={errors.phone} hint="Guests call this number. Include the country code, like +1 831 555 0100.">
            <Input type="tel" inputMode="tel" value={value.phone} onChange={(e) => set('phone', e.target.value)} autoComplete="tel" required />
          </Field>
          <Field label="Email" optional error={errors.email} hint="Where guests can write to you.">
            <Input type="email" value={value.email} onChange={(e) => set('email', e.target.value)} autoComplete="email" />
          </Field>
        </div>
      </Group>

      <Group title="Amenities" description="Pick from the suggestions or type your own and press Enter.">
        <Field label="Amenities" labelClassName="sr-only">
          <ChipInput value={value.amenities} onChange={(v) => set('amenities', v)} suggestions={PROPERTY_AMENITIES} placeholder="e.g. Rooftop terrace" />
        </Field>
      </Group>

      <Group title="Brand color" description="Used for buttons and accents on your guest booking pages.">
        <BrandColorPicker value={value.primaryColor} onChange={(v) => set('primaryColor', v)} name={value.name} />
      </Group>
    </div>
  );
}
