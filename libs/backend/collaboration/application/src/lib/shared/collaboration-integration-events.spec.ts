import { createCollaborationTestbed } from '../../testing/collaboration-fakes';
import { CreateCommentUseCase, EditCommentUseCase } from '../use-cases/comment-writes.use-cases';
import { CollaborationIntegrationEventType } from './collaboration-integration-events';

const uuid = (suffix: string) => `0192a000-0000-7000-8000-${suffix.padStart(12, '0')}`;
const [ANA, BIA, CAIO, OTTO] = [uuid('a1'), uuid('b1'), uuid('c1'), uuid('d1')];
const as = (userId: string) => ({
  requestId: 'req-1',
  actor: { userId, sessionId: `s-${userId}` },
  tenant: { organizationId: 'org-a', organizationRole: 'member' as const },
});

function world() {
  const bed = createCollaborationTestbed();
  bed.discussion.addTask({
    organizationId: 'org-a',
    projectId: 'p-web',
    taskId: 't-1',
    archived: false,
    canceled: false,
  });
  for (const userId of [ANA, BIA, CAIO]) bed.discussion.setRole('org-a', 'p-web', userId, 'member');
  return bed;
}

// ADR 0017 / obrigação 1 da spec 010: menções novas viram evento de integração na transação.
describe('collaboration integration events (spec 008, T4)', () => {
  it('a comment with mentions records them; an edit records only the new ones', async () => {
    const bed = world();
    const created = await new CreateCommentUseCase(bed).execute(as(ANA), {
      taskId: 't-1',
      body: `oi <@${BIA}>`,
    });
    await new EditCommentUseCase(bed).execute(as(ANA), {
      commentId: created.id,
      body: `oi <@${BIA}> e <@${CAIO}>`,
      version: 1,
    });

    expect(bed.outbox.events.map((event) => [event.type, event.payload])).toEqual([
      [
        CollaborationIntegrationEventType.mentionsAdded,
        {
          organizationId: 'org-a',
          projectId: 'p-web',
          taskId: 't-1',
          commentId: created.id,
          actorUserId: ANA,
          userIds: [BIA],
        },
      ],
      [
        CollaborationIntegrationEventType.mentionsAdded,
        {
          organizationId: 'org-a',
          projectId: 'p-web',
          taskId: 't-1',
          commentId: created.id,
          actorUserId: ANA,
          userIds: [CAIO],
        },
      ],
    ]);
  });

  it('no new mention, removal or a refused comment record nothing', async () => {
    const bed = world();
    const create = new CreateCommentUseCase(bed);
    const plain = await create.execute(as(ANA), { taskId: 't-1', body: 'sem menção' });
    await expect(
      create.execute(as(ANA), { taskId: 't-1', body: `<@${OTTO}>` }),
    ).rejects.toMatchObject({
      code: 'INVALID_MENTION',
    });
    await new EditCommentUseCase(bed).execute(as(ANA), {
      commentId: plain.id,
      body: 'ainda sem menção',
      version: 1,
    });

    expect(bed.outbox.events).toEqual([]);
  });

  it('BR-010: if the outbox fails, the comment is not saved', async () => {
    const bed = world();
    bed.outbox.append = () => Promise.reject(new Error('outbox down'));

    await expect(
      new CreateCommentUseCase(bed).execute(as(ANA), { taskId: 't-1', body: `oi <@${BIA}>` }),
    ).rejects.toThrow('outbox down');

    expect(bed.comments.rows).toEqual([]);
  });
});
