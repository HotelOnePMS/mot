import { describe, expect, it } from 'vitest';
import { addDaysISO, diffDays, eachNight, hotelToday, hourIn, isISODate, isTimeZone } from '@/server/dates';
import { policyFor } from '@/server/services/guest';
import { localeOf } from '@/server/services/hotels';

// 2026-10-19 06:30 UTC: still the 18th in Los Angeles, already the 19th in Tokyo.
const instant = new Date('2026-10-19T06:30:00Z');

describe('hotel clock', () => {
  it('gives each hotel its own today', () => {
    expect(hotelToday(instant, 'America/Los_Angeles')).toBe('2026-10-18');
    expect(hotelToday(instant, 'Asia/Tokyo')).toBe('2026-10-19');
    expect(hotelToday(instant, 'Europe/Lisbon')).toBe('2026-10-19');
  });

  it('reads the hour on the hotel’s clock', () => {
    expect(hourIn('UTC', instant)).toBe(6);
    expect(hourIn('Asia/Tokyo', instant)).toBe(15);
  });

  it('validates time zones', () => {
    expect(isTimeZone('Europe/Lisbon')).toBe(true);
    expect(isTimeZone('Mars/Olympus')).toBe(false);
    expect(isTimeZone('')).toBe(false);
  });

  it('falls back to the platform zone and USD', () => {
    expect(localeOf({ timezone: null, currency: null })).toEqual({ timezone: 'America/Los_Angeles', currency: 'USD' });
    expect(localeOf({ timezone: 'Asia/Tokyo', currency: 'JPY' })).toEqual({ timezone: 'Asia/Tokyo', currency: 'JPY' });
    expect(localeOf({ timezone: 'not/a-zone', currency: 'EUR' }).timezone).toBe('America/Los_Angeles');
  });

  it('does calendar-day arithmetic without time zone drift', () => {
    expect(addDaysISO('2026-03-07', 2)).toBe('2026-03-09'); // across the US DST change
    expect(diffDays('2026-10-30', '2026-11-02')).toBe(3);
    expect(eachNight('2026-12-30', '2027-01-02')).toEqual(['2026-12-30', '2026-12-31', '2027-01-01']);
    expect(isISODate('2026-02-30')).toBe(false);
  });
});

describe('free cancellation cut-off (3 PM hotel time, the day before arrival)', () => {
  it('uses the hotel’s clock, not the server’s', () => {
    // 15:30 in Tokyo on the 19th: past the cut-off for a stay starting the 20th…
    expect(policyFor('2026-10-20', 'Asia/Tokyo', instant).passed).toBe(true);
    // …but in Los Angeles it is still the morning of the 18th.
    expect(policyFor('2026-10-20', 'America/Los_Angeles', instant).passed).toBe(false);
    expect(policyFor('2026-10-20', 'America/Los_Angeles', instant).deadlineDay).toBe('2026-10-19');
  });
});
