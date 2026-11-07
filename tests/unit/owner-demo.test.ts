import { describe, expect, it } from 'vitest';
import { TOUR_STOPS, TOUR_STOP_IDS, nextTourStop, tourStop } from '@/config/tour';
import { CONCIERGE_TOOLS, GUEST_AGENT_TOOLS, GUEST_TOOLS, TOUR_TOOLS, conciergePrompts } from '@/server/voice/live';
import { sessionQuery } from '@/components/voice/types';
import { pageFromPath } from '@/components/voice/page-context';
import { SAMPLE } from '@/components/tour/sample-data';

describe('owner demo tour', () => {
  it('has unique stops covering the main features', () => {
    expect(new Set(TOUR_STOP_IDS).size).toBe(TOUR_STOPS.length);
    for (const id of ['overview', 'front-desk', 'bookings', 'payments', 'disputes', 'channels', 'reports']) expect(TOUR_STOP_IDS).toContain(id);
    for (const s of TOUR_STOPS) expect(s.explain.length).toBeGreaterThan(40);
  });

  it('walks the stops in order', () => {
    expect(nextTourStop('overview')).toBe(TOUR_STOP_IDS[1]);
    expect(nextTourStop(TOUR_STOP_IDS.at(-1)!)).toBeNull();
    expect(nextTourStop('nope')).toBeNull();
    expect(tourStop('disputes')?.title).toBeTruthy();
    expect(tourStop('../admin')).toBeNull();
  });

  it('points sample shortcuts at real stops', () => {
    for (const a of SAMPLE.attention) expect(TOUR_STOP_IDS).toContain(a.stop);
  });

  it('gives the concierge the tour tools, with the stops as the only choices', () => {
    const show = CONCIERGE_TOOLS.find((t) => t.name === 'show_demo_stop');
    expect(CONCIERGE_TOOLS.some((t) => t.name === 'start_owner_demo')).toBe(true);
    expect((show?.parameters as { properties: { stop: { enum: string[] } } }).properties.stop.enum).toEqual(TOUR_STOP_IDS);
    // The ElevenLabs guest agent carries every concierge tool; a hotel's own desk doesn't get these.
    for (const name of TOUR_TOOLS) {
      expect(GUEST_AGENT_TOOLS.some((t) => t.name === name)).toBe(true);
      expect(GUEST_TOOLS.some((t) => t.name === name)).toBe(false);
    }
  });

  it('greets owners as the product guide only when asked', () => {
    const base = { product: 'HotelOne', today: '2026-11-07', timezone: 'UTC' };
    expect(conciergePrompts({ ...base, owners: true }).instructions).toMatch(/AI guide/);
    expect(conciergePrompts(base).instructions).not.toMatch(/AI guide/);
    expect(conciergePrompts(base).backendInstructions).toMatch(/start_owner_demo/);
  });

  it('sends intro=owners only for concierge sessions', () => {
    expect(sessionQuery({ audience: 'guest', scope: 'global', propertyId: undefined, intro: 'owners' })).toBe('audience=guest&scope=global&intro=owners');
    expect(sessionQuery({ audience: 'guest', scope: 'hotel', propertyId: 'p1', intro: 'owners' })).toBe('audience=guest&propertyId=p1');
  });

  it('knows the tour page from its path', () => {
    expect(pageFromPath('/demo/tour').kind).toBe('tour');
  });
});
