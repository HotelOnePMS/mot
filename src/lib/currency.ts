/**
 * Currency helpers shared by server and client. Every hotel prices in its
 * own ISO 4217 currency (Property.currency); amounts are rounded to that
 * currency's minor unit (2 for USD/EUR, 0 for JPY, 3 for KWD), and Stripe
 * takes them in minor units.
 */

export const DEFAULT_CURRENCY = 'USD';

/** Currencies offered first in the hotel settings (any ISO 4217 code is accepted). */
export const COMMON_CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'MXN', 'BRL', 'INR', 'JPY', 'SGD', 'AED', 'CHF', 'ZAR', 'THB'] as const;

let known: Set<string> | null = null;
function supported(): Set<string> {
  if (!known) {
    try {
      known = new Set(Intl.supportedValuesOf('currency'));
    } catch {
      known = new Set(COMMON_CURRENCIES);
    }
  }
  return known;
}

/** A three-letter ISO 4217 code this runtime can format ("USD", "EUR"). */
export function isCurrencyCode(code: unknown): code is string {
  return typeof code === 'string' && /^[A-Z]{3}$/.test(code) && supported().has(code);
}

/** The currency, or USD when it is missing or unknown. */
export function currencyOrDefault(code: string | null | undefined): string {
  const c = code?.trim().toUpperCase();
  return c && isCurrencyCode(c) ? c : DEFAULT_CURRENCY;
}

const digitsCache = new Map<string, number>();

/** Decimal places of the currency's minor unit: USD 2, JPY 0, KWD 3. */
export function currencyDigits(currency: string): number {
  const c = currencyOrDefault(currency);
  let d = digitsCache.get(c);
  if (d === undefined) {
    d = new Intl.NumberFormat('en-US', { style: 'currency', currency: c }).resolvedOptions().maximumFractionDigits ?? 2;
    digitsCache.set(c, d);
  }
  return d;
}

/** Round half away from zero to the currency's minor unit. */
export function roundMoney(amount: number, currency: string): number {
  const factor = 10 ** currencyDigits(currency);
  const rounded = (Math.sign(amount) * Math.round((Math.abs(amount) + Number.EPSILON) * factor)) / factor;
  return rounded === 0 ? 0 : rounded;
}

/** The amount in the currency's smallest unit, as payment processors expect (12.34 USD → 1234, 1500 JPY → 1500). */
export function toMinorUnits(amount: number, currency: string): number {
  return Math.round(roundMoney(amount, currency) * 10 ** currencyDigits(currency));
}
