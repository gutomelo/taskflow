import {
  MAX_LOGIN_DELAY_SECONDS,
  remainingLoginDelaySeconds,
  requiredLoginDelaySeconds,
} from './progressive-login-delay';

const T0 = new Date('2026-10-08T12:00:00.000Z');
const at = (ms: number) => new Date(T0.getTime() + ms);

describe('progressive login delay (BR-018)', () => {
  it.each([
    [0, 0],
    [4, 0],
    [5, 1],
    [6, 2],
    [7, 4],
    [10, 32],
    [14, 512],
    [15, MAX_LOGIN_DELAY_SECONDS],
    [1000, MAX_LOGIN_DELAY_SECONDS],
  ])('BR-018: after %i consecutive failures requires %i s', (failures, seconds) => {
    expect(requiredLoginDelaySeconds(failures)).toBe(seconds);
  });

  it('BR-018: counts the remaining wait from the last failure', () => {
    const state = { consecutiveFailures: 7, lastFailureAt: T0 }; // exige 4 s

    expect(remainingLoginDelaySeconds(state, at(0))).toBe(4);
    expect(remainingLoginDelaySeconds(state, at(2_500))).toBe(2);
    expect(remainingLoginDelaySeconds(state, at(4_000))).toBe(0);
  });

  it('never blocks permanently: the cap is 15 minutes', () => {
    const state = { consecutiveFailures: 10_000, lastFailureAt: T0 };

    expect(remainingLoginDelaySeconds(state, at(MAX_LOGIN_DELAY_SECONDS * 1000))).toBe(0);
  });

  it('allows attempts without recorded failures', () => {
    expect(remainingLoginDelaySeconds({ consecutiveFailures: 0, lastFailureAt: null }, T0)).toBe(0);
  });
});
