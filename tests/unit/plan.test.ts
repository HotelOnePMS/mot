import { afterEach, describe, expect, it, vi } from 'vitest';
import { signPlan, verifyPlan } from '@/server/agent/plan';

const steps = [{ tool: 'check_in', args: { bookingId: 'b1', roomId: 'r1' }, summary: 'Check in Smith → 204' }];

describe('signed agent plans', () => {
  afterEach(() => vi.useRealTimers());

  it('verifies for the same user', () => {
    const { token } = signPlan({ userId: 'u1', propertyId: 'p1', title: 'Check in', steps });
    const plan = verifyPlan(token, 'u1');
    expect(plan.pid).toBe('p1');
    expect(plan.steps).toEqual(steps);
  });

  it('refuses another user', () => {
    const { token } = signPlan({ userId: 'u1', propertyId: 'p1', title: 'Check in', steps });
    expect(() => verifyPlan(token, 'u2')).toThrow(/someone else/);
  });

  it('refuses a changed plan', () => {
    const { token } = signPlan({ userId: 'u1', propertyId: 'p1', title: 'Check in', steps });
    const [body, sig] = token.split('.');
    const forged = JSON.parse(Buffer.from(body, 'base64url').toString());
    forged.steps[0].args.roomId = 'r9';
    const tampered = `${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${sig}`;
    expect(() => verifyPlan(tampered, 'u1')).toThrow(/could not be verified/);
  });

  it('expires after 10 minutes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-19T12:00:00Z'));
    const { token } = signPlan({ userId: 'u1', propertyId: 'p1', title: 'Check in', steps });
    vi.setSystemTime(new Date('2026-10-19T12:10:01Z'));
    expect(() => verifyPlan(token, 'u1')).toThrow(/expired/);
  });
});
