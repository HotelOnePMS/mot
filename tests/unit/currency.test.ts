import { describe, expect, it } from 'vitest';
import { currencyDigits, currencyOrDefault, isCurrencyCode, roundMoney, toMinorUnits } from '@/lib/currency';
import { money } from '@/lib/status';

describe('currency', () => {
  it('knows each currency’s minor unit', () => {
    expect(currencyDigits('USD')).toBe(2);
    expect(currencyDigits('JPY')).toBe(0);
    expect(currencyDigits('KWD')).toBe(3);
  });

  it('rounds half away from zero to the minor unit', () => {
    expect(roundMoney(1.005, 'USD')).toBe(1.01);
    expect(roundMoney(-12.345, 'USD')).toBe(-12.35);
    expect(roundMoney(1499.5, 'JPY')).toBe(1500);
    expect(roundMoney(-0.001, 'USD')).toBe(0);
  });

  it('gives Stripe amounts in minor units', () => {
    expect(toMinorUnits(12.34, 'USD')).toBe(1234);
    expect(toMinorUnits(0.1 + 0.2, 'EUR')).toBe(30);
    expect(toMinorUnits(15000, 'JPY')).toBe(15000);
    expect(toMinorUnits(1.2345, 'KWD')).toBe(1235);
  });

  it('accepts ISO codes and falls back to USD', () => {
    expect(isCurrencyCode('EUR')).toBe(true);
    expect(isCurrencyCode('eur')).toBe(false);
    expect(isCurrencyCode('XYZ1')).toBe(false);
    expect(currencyOrDefault(' gbp ')).toBe('GBP');
    expect(currencyOrDefault(null)).toBe('USD');
    expect(currencyOrDefault('nope')).toBe('USD');
  });

  it('formats in the hotel’s currency', () => {
    expect(money(1234.5)).toBe('$1,234.50');
    expect(money(189, { currency: 'EUR' })).toBe('€189.00');
    expect(money(15000, { currency: 'JPY' })).toBe('¥15,000');
    expect(money(99.5, { cents: false, currency: 'GBP' })).toBe('£100');
  });
});
