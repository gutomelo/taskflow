import type { Clock, IdGenerator } from '@taskflow/backend/shared/kernel';
import { createIntegrationEvent } from './integration-event';

const fixedInstant = new Date('2026-10-08T12:00:00.000Z');
const clock: Clock = { now: () => fixedInstant };
const idGenerator: IdGenerator = { generate: () => '01920000-0000-7000-8000-000000000001' };

describe('createIntegrationEvent', () => {
  it('stamps the event with a generated id and the current instant', () => {
    const event = createIntegrationEvent(
      'identity.email_verification_requested',
      { userId: 'user-1' },
      { idGenerator, clock },
    );

    expect(event).toEqual({
      id: '01920000-0000-7000-8000-000000000001',
      type: 'identity.email_verification_requested',
      occurredAt: fixedInstant,
      payload: { userId: 'user-1' },
    });
  });

  it('is immutable and isolated from later changes to the input payload', () => {
    const payload = { userId: 'user-1' };
    const event = createIntegrationEvent('sample.happened', payload, { idGenerator, clock });

    payload.userId = 'mutated';

    expect(event.payload.userId).toBe('user-1');
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event.payload)).toBe(true);
  });

  it('only accepts JSON-serializable payloads at compile time', () => {
    // @ts-expect-error Date não é serializável em JSON de forma estável.
    createIntegrationEvent('sample.happened', { at: new Date() }, { idGenerator, clock });
    // @ts-expect-error Funções não podem atravessar a outbox.
    createIntegrationEvent('sample.happened', { run: () => undefined }, { idGenerator, clock });

    expect(true).toBe(true);
  });
});
