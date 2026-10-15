import { NotificationNotFoundError } from './errors';
import {
  dedupeKey,
  dedupeKeyOf,
  recipientsOf,
  requireOwn,
  type NotificationFact,
} from './notification';

const fact = (overrides: Partial<NotificationFact> = {}): NotificationFact => ({
  kind: 'mention',
  organizationId: 'org',
  projectId: 'p',
  taskId: 't',
  commentId: 'c-1',
  actorUserId: 'ana',
  recipientUserIds: ['bia', 'caio'],
  sourceEventId: 'e-1',
  occurredAt: new Date('2026-10-15T10:00:00.000Z'),
  ...overrides,
});

describe('BR-033: notification facts', () => {
  it('never notifies the actor and never twice the same person', () => {
    expect(recipientsOf(fact({ recipientUserIds: ['bia', 'ana', 'bia', 'caio'] }))).toEqual([
      'bia',
      'caio',
    ]);
    expect(recipientsOf(fact({ kind: 'assignment', recipientUserIds: ['ana'] }))).toEqual([]);
  });

  it('D4: a mention dedupes by comment (any edit), an assignment by event', () => {
    expect(dedupeKeyOf(fact())).toBe('mention:c-1');
    expect(dedupeKeyOf(fact({ sourceEventId: 'e-2' }))).toBe(dedupeKey.mention('c-1'));
    expect(dedupeKeyOf(fact({ kind: 'assignment', commentId: null }))).toBe('assignment:e-1');
    expect(dedupeKeyOf(fact({ kind: 'assignment', commentId: null, sourceEventId: 'e-2' }))).toBe(
      'assignment:e-2',
    );
    expect(() => dedupeKeyOf(fact({ commentId: null }))).toThrow();
  });

  it("someone else's, missing or invisible notification is the same 404", () => {
    expect(requireOwn({ id: 'n' })).toEqual({ id: 'n' });
    expect(() => requireOwn(null)).toThrow(NotificationNotFoundError);
    expect(() => requireOwn(undefined)).toThrow(NotificationNotFoundError);
  });
});
