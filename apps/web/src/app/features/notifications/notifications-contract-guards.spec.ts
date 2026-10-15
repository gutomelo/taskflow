import {
  isNotificationPage,
  isNotificationPreference,
  isUnreadCount,
} from './notifications-contract-guards';

const item = {
  id: '0192a000-0000-7000-8000-0000000000e1',
  kind: 'mention',
  actor: { userId: '0192a000-0000-7000-8000-0000000000a1', name: null },
  task: { id: '0192a000-0000-7000-8000-0000000000f1', key: 'WEB-1', title: 'T' },
  commentId: '0192a000-0000-7000-8000-0000000000c1',
  occurredAt: '2026-10-15T10:00:00.000Z',
  readAt: null,
};

describe('notifications contract guards (spec 008)', () => {
  it('accepts the contract shapes', () => {
    expect(isNotificationPage({ items: [item], nextCursor: 'x' })).toBe(true);
    expect(isUnreadCount({ count: 99, capped: true })).toBe(true);
    expect(isNotificationPreference({ emailDigest: false })).toBe(true);
  });

  it.each([
    ['an unknown kind', { items: [{ ...item, kind: 'comment' }], nextCursor: null }],
    ['a bad date', { items: [{ ...item, occurredAt: 'ontem' }], nextCursor: null }],
    ['a task without key', { items: [{ ...item, task: { id: item.task.id } }], nextCursor: null }],
    ['a missing cursor', { items: [] }],
  ])('refuses a page with %s', (_case, page) => {
    expect(isNotificationPage(page)).toBe(false);
  });

  it.each([
    { count: 100, capped: true },
    { count: -1, capped: false },
    { count: 1.5, capped: false },
    { count: 1 },
  ])('refuses the unread count %j', (value) => {
    expect(isUnreadCount(value)).toBe(false);
  });
});
