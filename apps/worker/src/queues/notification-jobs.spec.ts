import { UnrecoverableError, type Job } from 'bullmq';
import { pino } from 'pino';
import { CollaborationIntegrationEventType } from '@taskflow/backend/collaboration/application';
import type { NotificationFact } from '@taskflow/backend/notifications/domain';
import type { OutboxJobData } from '@taskflow/backend/shared/infrastructure';
import { TasksIntegrationEventType } from '@taskflow/backend/tasks/application';
import { digestJobId } from '../notification-delivery';
import {
  createNotificationJobProcessor,
  NOTIFICATION_EVENT_TYPES,
  NOTIFICATIONS_QUEUE_NAME,
} from './notification-jobs';
import { EMAIL_EVENT_TYPES } from './email-queue';

const uuid = (suffix: string) => `0192a000-0000-7000-8000-${suffix.padStart(12, '0')}`;
const EVENT_ID = uuid('e1');
const OCCURRED_AT = '2026-10-15T10:30:00.000Z';
const ids = {
  organizationId: uuid('0a'),
  projectId: uuid('0b'),
  taskId: uuid('0c'),
  actorUserId: uuid('a1'),
};

function job(data: Record<string, unknown>): Job<OutboxJobData> {
  const full = { eventId: EVENT_ID, occurredAt: OCCURRED_AT, ...data };
  // O processador só lê `data` e `attemptsMade`; o restante do Job do BullMQ não é usado.
  return { data: full, attemptsMade: 0 } as unknown as Job<OutboxJobData>;
}

function setup() {
  const facts: NotificationFact[] = [];
  const process = createNotificationJobProcessor(
    {
      execute: async (fact) => {
        facts.push(fact);
        return { created: fact.recipientUserIds.length, duplicate: 0, ineligible: 0, capped: 0 };
      },
    },
    pino({ level: 'silent' }),
  );
  return { facts, process };
}

const assigneeChanged = (payload: Record<string, unknown> = {}) =>
  job({
    type: TasksIntegrationEventType.assigneeChanged,
    payload: { ...ids, assigneeUserId: uuid('b1'), ...payload },
  });
const mentionsAdded = (payload: Record<string, unknown> = {}) =>
  job({
    type: CollaborationIntegrationEventType.mentionsAdded,
    payload: { ...ids, commentId: uuid('c0'), userIds: [uuid('b1'), uuid('d1')], ...payload },
  });

describe('notification job processor (spec 008, T8)', () => {
  it('translates an assignment into the notifications fact (anti-corruption layer)', async () => {
    const { facts, process } = setup();

    expect(await process(assigneeChanged())).toMatchObject({ created: 1 });

    expect(facts).toEqual([
      {
        ...ids,
        kind: 'assignment',
        commentId: null,
        recipientUserIds: [uuid('b1')],
        sourceEventId: EVENT_ID,
        occurredAt: new Date(OCCURRED_AT),
      },
    ]);
  });

  it('translates new mentions into the notifications fact', async () => {
    const { facts, process } = setup();

    await process(mentionsAdded());

    expect(facts).toEqual([
      {
        ...ids,
        kind: 'mention',
        commentId: uuid('c0'),
        recipientUserIds: [uuid('b1'), uuid('d1')],
        sourceEventId: EVENT_ID,
        occurredAt: new Date(OCCURRED_AT),
      },
    ]);
  });

  it.each([
    ['an unknown type', job({ type: 'tasks.created', payload: ids })],
    ['an unknown payload field', assigneeChanged({ title: 'Login' })],
    ['an unknown envelope field', job({ ...assigneeChanged().data, extra: true })],
    ['a non-uuid id', assigneeChanged({ taskId: 'WEB-1' })],
    ['no mentioned user', mentionsAdded({ userIds: [] })],
    ['a repeated mentioned user', mentionsAdded({ userIds: [uuid('b1'), uuid('b1')] })],
    [
      'more mentions than a comment allows',
      mentionsAdded({ userIds: Array.from({ length: 21 }, (_, index) => uuid(`f${index}`)) }),
    ],
    ['a bad occurrence date', job({ ...assigneeChanged().data, occurredAt: 'ontem' })],
  ])('refuses %s without retry and without recording', async (_case, invalid) => {
    const { facts, process } = setup();

    await expect(process(invalid)).rejects.toBeInstanceOf(UnrecoverableError);
    expect(facts).toEqual([]);
  });

  it('routes only its two event types, none shared with the email queue', () => {
    expect(NOTIFICATIONS_QUEUE_NAME).toBe('notifications');
    expect(NOTIFICATION_EVENT_TYPES).toEqual([
      'tasks.assignee_changed',
      'collaboration.mentions_added',
    ]);
    expect(NOTIFICATION_EVENT_TYPES.filter((type) => EMAIL_EVENT_TYPES.includes(type))).toEqual([]);
  });
});

describe('digest job id (D5)', () => {
  it('one per person and UTC hour, without the ":" BullMQ reserves', () => {
    const at = new Date('2026-10-15T09:59:59.999Z');

    expect(digestJobId(uuid('b1'), at)).toBe(`digest-${uuid('b1')}-2026101509`);
    expect(digestJobId(uuid('b1'), new Date('2026-10-15T09:00:00.000Z'))).toBe(
      digestJobId(uuid('b1'), at),
    );
    expect(digestJobId(uuid('b1'), new Date('2026-10-15T10:00:00.000Z'))).not.toBe(
      digestJobId(uuid('b1'), at),
    );
    expect(digestJobId(uuid('b1'), at)).not.toContain(':');
  });
});
