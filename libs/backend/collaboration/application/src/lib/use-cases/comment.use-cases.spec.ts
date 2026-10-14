import { RateLimitedError, type TenantRequestContext } from '@taskflow/backend/shared/application';
import type { OrganizationRole, ProjectRole } from '@taskflow/backend/shared/kernel';
import {
  createCollaborationTestbed,
  type CollaborationTestbed,
} from '../../testing/collaboration-fakes';
import {
  COMMENT_WRITE_POLICY,
  MAX_COMMENTS_PER_TASK,
  MENTION_SEARCH_POLICY,
} from '../shared/collaboration-limits';
import {
  GetCommentUseCase,
  ListCommentsUseCase,
  ListMentionCandidatesUseCase,
} from './comment-queries.use-cases';
import {
  CreateCommentUseCase,
  DeleteCommentUseCase,
  EditCommentUseCase,
} from './comment-writes.use-cases';

const ORG = 'org-a';
const OTHER_ORG = 'org-b';
const WEB = 'p-web';
const TASK = 't-web-1';
const OTHER_TASK = 't-web-2';
const FOREIGN_TASK = 't-b-1';
const uuid = (suffix: string) => `0192a000-0000-7000-8000-${suffix.padStart(12, '0')}`;

/** Ana owner (manager efetiva), mia manager, bia e caio members, vivi viewer, otto sem acesso. */
const PEOPLE = {
  ana: { id: uuid('a1'), name: 'Ana', role: 'manager', org: 'owner' },
  mia: { id: uuid('a2'), name: 'Mia', role: 'manager', org: 'member' },
  bia: { id: uuid('a3'), name: 'Bia', role: 'member', org: 'member' },
  caio: { id: uuid('a4'), name: 'Caio', role: 'member', org: 'member' },
  vivi: { id: uuid('a5'), name: 'Vivi', role: 'viewer', org: 'viewer' },
  otto: { id: uuid('a6'), name: 'Otto', role: null, org: 'member' },
  zoe: { id: uuid('b1'), name: 'Zoe', role: null, org: null },
} as const satisfies Record<
  string,
  { id: string; name: string; role: ProjectRole | null; org: OrganizationRole | null }
>;
type Person = keyof typeof PEOPLE;
const id = (person: Person) => PEOPLE[person].id;
const token = (person: Person) => `<@${id(person)}>`;

function as(person: Person): TenantRequestContext {
  return {
    requestId: 'req-1',
    actor: { userId: id(person), sessionId: `s-${person}` },
    tenant: { organizationId: ORG, organizationRole: PEOPLE[person].org ?? 'member' },
  };
}

function world() {
  const bed = createCollaborationTestbed();
  const web = bed.discussion.addTask({
    organizationId: ORG,
    projectId: WEB,
    taskId: TASK,
    archived: false,
    canceled: false,
  });
  bed.discussion.addTask({
    organizationId: ORG,
    projectId: WEB,
    taskId: OTHER_TASK,
    archived: false,
    canceled: false,
  });
  bed.discussion.addTask({
    organizationId: OTHER_ORG,
    projectId: 'p-b',
    taskId: FOREIGN_TASK,
    archived: false,
    canceled: false,
  });
  for (const [, person] of Object.entries(PEOPLE)) {
    bed.discussion.setRole(ORG, WEB, person.id, person.role);
    bed.discussion.people.set(person.id, {
      name: person.name,
      email: `${person.name.toLowerCase()}@exemplo.com`,
    });
    bed.users.names.set(person.id, person.name);
    if (person.org) bed.users.members.add(`${ORG}|${person.id}`);
  }
  bed.discussion.setRole(OTHER_ORG, 'p-b', id('zoe'), 'manager');
  return { bed, web };
}

const code = (promise: Promise<unknown>) =>
  promise.then(
    () => 'ok',
    (error: { code?: string; name?: string }) => error.code ?? error.name,
  );

const create = (bed: CollaborationTestbed, person: Person, body: string, taskId = TASK) =>
  new CreateCommentUseCase(bed).execute(as(person), { taskId, body });
const edit = (
  bed: CollaborationTestbed,
  person: Person,
  commentId: string,
  body: string,
  version = 1,
) => new EditCommentUseCase(bed).execute(as(person), { commentId, body, version });
const remove = (bed: CollaborationTestbed, person: Person, commentId: string, version = 1) =>
  new DeleteCommentUseCase(bed).execute(as(person), { commentId, version });
const list = (
  bed: CollaborationTestbed,
  person: Person,
  query: { cursor?: string | null; limit?: number; taskId?: string } = {},
) => new ListCommentsUseCase(bed).execute(as(person), { taskId: TASK, ...query });

describe('CreateComment (RF-02, RF-03, BR-031, BR-032)', () => {
  it('a member comments with mentions; the event carries only ids, after the commit', async () => {
    const { bed } = world();

    const view = await create(
      bed,
      'bia',
      `Pode revisar, ${token('mia')} e ${token('vivi')}? ${token('mia')}`,
    );

    expect(view).toMatchObject({
      taskId: TASK,
      author: { userId: id('bia'), name: 'Bia' },
      mentions: [
        { userId: id('mia'), name: 'Mia' },
        { userId: id('vivi'), name: 'Vivi' },
      ],
      version: 1,
      editedAt: null,
      deletedAt: null,
      actions: { edit: true, delete: true },
    });
    expect(bed.events.events).toEqual([
      {
        type: 'collaboration.comment_created',
        requestId: 'req-1',
        organizationId: ORG,
        actorUserId: id('bia'),
        projectId: WEB,
        taskId: TASK,
        commentId: view.id,
        mentionedUserIds: [id('mia'), id('vivi')],
      },
    ]);
    expect(bed.discussion.locks).toEqual([
      { taskId: TASK, userIds: [id('bia'), id('mia'), id('vivi')] },
    ]);
    expect(bed.transactions.options).toEqual([{ lockTimeoutMs: 2000 }]);
  });

  it('owner and admin (manager effective) and every reader can be mentioned; the author cannot', async () => {
    const { bed } = world();
    const view = await create(bed, 'mia', `${token('ana')} ${token('vivi')} ${token('mia')}`);
    expect(view.mentions.map((mention) => mention.userId)).toEqual([id('ana'), id('vivi')]);
  });

  it('decides input → 404 → 403 → archived → canceled → mentions → limit', async () => {
    const { bed, web } = world();
    expect(await code(create(bed, 'bia', '   '))).toBe('INVALID_COMMENT_BODY');
    expect(bed.discussion.locks).toEqual([]);
    expect(await code(create(bed, 'otto', 'oi'))).toBe('TASK_NOT_FOUND');
    expect(await code(create(bed, 'bia', 'oi', FOREIGN_TASK))).toBe('TASK_NOT_FOUND');
    expect(await code(create(bed, 'bia', 'oi', 'missing'))).toBe('TASK_NOT_FOUND');
    web.archived = true;
    web.canceled = true;
    expect(await code(create(bed, 'vivi', 'oi'))).toBe('INSUFFICIENT_ROLE');
    expect(await code(create(bed, 'bia', token('otto')))).toBe('PROJECT_ARCHIVED');
    web.archived = false;
    expect(await code(create(bed, 'bia', token('otto')))).toBe('TASK_CANCELED');
    web.canceled = false;
    expect(await code(create(bed, 'bia', token('otto')))).toBe('INVALID_MENTION');
    expect(bed.comments.rows).toEqual([]);
    expect(bed.events.events).toEqual([]);
  });

  it('BR-032: someone without access, from another organization or unknown gives the same 422', async () => {
    const { bed } = world();
    const refusals = await Promise.all(
      [token('otto'), token('zoe'), `<@${uuid('ffff')}>`].map(async (mention) => {
        const error: unknown = await create(bed, 'bia', `oi ${mention}`).catch(
          (caught: unknown) => caught,
        );
        return error instanceof Error ? [error.constructor.name, error.message] : error;
      }),
    );
    expect(new Set(refusals.map((refusal) => JSON.stringify(refusal))).size).toBe(1);
    expect(refusals[0]).toEqual([
      'InvalidMentionError',
      'A mentioned person cannot read this project',
    ]);
  });

  it('more than 20 distinct people is refused before any lock', async () => {
    const { bed } = world();
    const many = Array.from({ length: 21 }, (_, index) => `<@${uuid(`c${index}`)}>`).join(' ');
    expect(await code(create(bed, 'bia', many))).toBe('TOO_MANY_MENTIONS');
    expect(bed.discussion.locks).toEqual([]);
  });

  it('the task comment limit counts only comments not removed', async () => {
    const { bed } = world();
    for (let index = 0; index < MAX_COMMENTS_PER_TASK; index += 1) {
      bed.comments.rows.push({
        id: uuid(`d${index}`),
        organizationId: ORG,
        projectId: WEB,
        taskId: TASK,
        authorUserId: id('bia'),
        body: index === 0 ? null : 'x',
        mentionedUserIds: [],
        createdAt: bed.clock.now(),
        editedAt: null,
        deletedAt: index === 0 ? bed.clock.now() : null,
        deletedByUserId: null,
        version: 1,
      });
    }
    expect(await code(create(bed, 'bia', 'cabe um'))).toBe('ok');
    expect(await code(create(bed, 'bia', 'não cabe'))).toBe('COMMENT_LIMIT_REACHED');
    expect(await code(create(bed, 'bia', 'outra tarefa', OTHER_TASK))).toBe('ok');
  });

  it('every attempt counts against the write limit, refused ones too', async () => {
    const { bed } = world();
    bed.rateLimiter.consumed.set(
      `${COMMENT_WRITE_POLICY.name}|${id('bia')}`,
      COMMENT_WRITE_POLICY.points - 1,
    );
    expect(await code(create(bed, 'bia', '   '))).toBe('INVALID_COMMENT_BODY');
    await expect(create(bed, 'bia', 'oi')).rejects.toBeInstanceOf(RateLimitedError);
  });
});

describe('ListComments / GetComment (RF-01, RF-07, RF-13, RF-14, RF-15)', () => {
  it('newest first by cursor, count on the first page, names in one call, ex-members without name', async () => {
    const { bed } = world();
    const first = await create(bed, 'bia', `um ${token('caio')}`);
    bed.clock.advance(1000);
    const second = await create(bed, 'caio', 'dois');
    bed.clock.advance(1000);
    const third = await create(bed, 'mia', 'três');
    await remove(bed, 'mia', third.id);
    bed.users.members.delete(`${ORG}|${id('caio')}`);
    bed.users.calls = 0;

    const page = await list(bed, 'vivi', { limit: 2 });
    const next = await list(bed, 'vivi', { limit: 2, cursor: page.nextCursor });

    expect(page.items.map((item) => item.id)).toEqual([third.id, second.id]);
    expect(page.items[0]).toMatchObject({ body: null, mentions: [], author: { name: 'Mia' } });
    expect(page.items[1]).toMatchObject({ author: { userId: id('caio'), name: null } });
    expect(page.count).toBe(2);
    expect(page.actions).toEqual({ comment: false });
    expect(next.items.map((item) => item.id)).toEqual([first.id]);
    expect(next.items[0]?.mentions).toEqual([{ userId: id('caio'), name: null }]);
    expect(next.nextCursor).toBeNull();
    expect(next).not.toHaveProperty('count');
    expect(bed.users.calls).toBe(2);
    // Página exata: sem próxima página.
    expect((await list(bed, 'vivi', { limit: 3 })).nextCursor).toBeNull();
  });

  it('mentions come in the order they appear in the text, whatever the storage order', async () => {
    const { bed } = world();
    const view = await create(bed, 'bia', `${token('mia')} e ${token('vivi')}`);
    const [stored] = bed.comments.rows;
    if (!stored) throw new Error('comment not stored');
    bed.comments.rows[0] = { ...stored, mentionedUserIds: [id('vivi'), id('mia')] };

    const page = await list(bed, 'bia');

    expect(
      page.items.find((item) => item.id === view.id)?.mentions.map((mention) => mention.userId),
    ).toEqual([id('mia'), id('vivi')]);
  });

  it('actions per comment follow the role, ownership and state', async () => {
    const { bed, web } = world();
    const own = await create(bed, 'bia', 'meu');
    const others = await create(bed, 'caio', 'dele');

    const asBia = await list(bed, 'bia');
    const asMia = await list(bed, 'mia');
    web.canceled = true;
    const canceled = await list(bed, 'bia');

    const actions = (page: typeof asBia, commentId: string) =>
      page.items.find((item) => item.id === commentId)?.actions;
    expect(asBia.actions).toEqual({ comment: true });
    expect(actions(asBia, own.id)).toEqual({ edit: true, delete: true });
    expect(actions(asBia, others.id)).toEqual({ edit: false, delete: false });
    expect(actions(asMia, others.id)).toEqual({ edit: false, delete: true });
    expect(canceled.actions).toEqual({ comment: false });
    expect(actions(canceled, own.id)).toEqual({ edit: false, delete: true });
    await remove(bed, 'bia', own.id);
    expect(actions(await list(bed, 'mia'), own.id)).toEqual({ edit: false, delete: false });
  });

  it('a cursor of another task, tampered or malformed is 400; no access is 404', async () => {
    const { bed } = world();
    for (let index = 0; index < 3; index += 1) await create(bed, 'bia', `c${index}`);
    const { nextCursor } = await list(bed, 'bia', { limit: 1 });

    expect(await code(list(bed, 'bia', { taskId: OTHER_TASK, cursor: nextCursor }))).toBe(
      'INVALID_CURSOR',
    );
    expect(await code(list(bed, 'bia', { cursor: 'lixo' }))).toBe('INVALID_CURSOR');
    expect(
      await code(
        list(bed, 'bia', {
          cursor: Buffer.from('{"t":"t-web-1","c":"x","i":"y"}').toString('base64url'),
        }),
      ),
    ).toBe('INVALID_CURSOR');
    const badDate = Buffer.from(JSON.stringify({ t: TASK, c: 'ontem', i: uuid('1') })).toString(
      'base64url',
    );
    expect(await code(list(bed, 'bia', { cursor: badDate }))).toBe('INVALID_CURSOR');
    expect(await code(list(bed, 'otto'))).toBe('TASK_NOT_FOUND');
    expect(await code(list(bed, 'bia', { taskId: FOREIGN_TASK }))).toBe('TASK_NOT_FOUND');
  });

  it('GetComment: the same COMMENT_NOT_FOUND for missing, another organization and no access', async () => {
    const { bed } = world();
    const view = await create(bed, 'bia', 'oi');
    const [stored] = bed.comments.rows;
    if (!stored) throw new Error('comment not stored');
    bed.comments.rows.push({
      ...stored,
      id: uuid('e1'),
      organizationId: OTHER_ORG,
      taskId: FOREIGN_TASK,
    });

    expect((await new GetCommentUseCase(bed).execute(as('vivi'), view.id)).id).toBe(view.id);
    for (const [person, commentId] of [
      ['bia', uuid('dead')],
      ['bia', uuid('e1')],
      ['otto', view.id],
    ] as const) {
      expect(await code(new GetCommentUseCase(bed).execute(as(person), commentId))).toBe(
        'COMMENT_NOT_FOUND',
      );
    }
  });
});

describe('EditComment (RF-04, BR-008, D10)', () => {
  it('the author edits with the version; the event carries only the new mentions', async () => {
    const { bed } = world();
    const view = await create(bed, 'bia', `oi ${token('mia')} ${token('caio')}`);
    bed.events.events.length = 0;
    bed.discussion.locks.length = 0;

    const edited = await edit(bed, 'bia', view.id, `oi ${token('mia')} ${token('ana')}`);

    expect(edited).toMatchObject({ version: 2, editedAt: bed.clock.now() });
    expect(edited.mentions.map((mention) => mention.userId)).toEqual([id('mia'), id('ana')]);
    expect(bed.events.events).toMatchObject([
      {
        type: 'collaboration.comment_edited',
        mentionedUserIds: [id('mia'), id('ana')],
        addedMentionUserIds: [id('ana')],
      },
    ]);
    expect(bed.discussion.locks).toEqual([{ taskId: TASK, userIds: [id('bia'), id('ana')] }]);
    expect(bed.comments.locks).toEqual([view.id]);
  });

  it('D10: keeps a mention of someone who lost access; a new one must read the project', async () => {
    const { bed } = world();
    const view = await create(bed, 'bia', `oi ${token('caio')}`);
    bed.discussion.setRole(ORG, WEB, id('caio'), null);

    expect(await code(edit(bed, 'bia', view.id, `olá ${token('caio')}`))).toBe('ok');
    expect(await code(edit(bed, 'bia', view.id, `olá ${token('caio')} ${token('otto')}`, 2))).toBe(
      'INVALID_MENTION',
    );
  });

  it('the same text changes nothing and records no event', async () => {
    const { bed } = world();
    const view = await create(bed, 'bia', 'oi');
    bed.events.events.length = 0;
    expect(await edit(bed, 'bia', view.id, '  oi  ')).toMatchObject({ version: 1, editedAt: null });
    expect(bed.events.events).toEqual([]);
  });

  it('decides input → 404 → 403 → archived → canceled → removed → version → mentions', async () => {
    const { bed, web } = world();
    const view = await create(bed, 'bia', 'oi');
    expect(await code(edit(bed, 'bia', view.id, ''))).toBe('INVALID_COMMENT_BODY');
    expect(await code(edit(bed, 'otto', view.id, 'x'))).toBe('COMMENT_NOT_FOUND');
    expect(await code(edit(bed, 'bia', uuid('dead'), 'x'))).toBe('COMMENT_NOT_FOUND');
    expect(await code(edit(bed, 'caio', view.id, 'x'))).toBe('INSUFFICIENT_ROLE');
    expect(await code(edit(bed, 'mia', view.id, 'x'))).toBe('INSUFFICIENT_ROLE');
    web.archived = true;
    expect(await code(edit(bed, 'bia', view.id, token('otto'), 9))).toBe('PROJECT_ARCHIVED');
    web.archived = false;
    web.canceled = true;
    expect(await code(edit(bed, 'bia', view.id, token('otto'), 9))).toBe('TASK_CANCELED');
    web.canceled = false;
    expect(await code(edit(bed, 'bia', view.id, token('otto'), 9))).toBe('VERSION_CONFLICT');
    expect(await code(edit(bed, 'bia', view.id, token('otto')))).toBe('INVALID_MENTION');
    await remove(bed, 'bia', view.id);
    expect(await code(edit(bed, 'bia', view.id, 'x', 9))).toBe('COMMENT_DELETED');
  });

  it('an author demoted to viewer can no longer edit nor delete', async () => {
    const { bed } = world();
    const view = await create(bed, 'bia', 'oi');
    bed.discussion.setRole(ORG, WEB, id('bia'), 'viewer');
    expect(await code(edit(bed, 'bia', view.id, 'x'))).toBe('INSUFFICIENT_ROLE');
    expect(await code(remove(bed, 'bia', view.id))).toBe('INSUFFICIENT_ROLE');
  });
});

describe('DeleteComment (RF-05, D4, decision 9)', () => {
  it('the author removes once; a manager moderates; a member cannot remove others', async () => {
    const { bed } = world();
    const own = await create(bed, 'bia', `oi ${token('mia')}`);
    const others = await create(bed, 'caio', 'dele');
    bed.events.events.length = 0;

    await remove(bed, 'bia', own.id);
    await remove(bed, 'bia', own.id, 9);
    expect(await code(remove(bed, 'bia', others.id))).toBe('INSUFFICIENT_ROLE');
    await remove(bed, 'mia', others.id);

    expect(bed.comments.rows.find((row) => row.id === own.id)).toMatchObject({
      body: null,
      mentionedUserIds: [],
      deletedByUserId: id('bia'),
      version: 2,
    });
    expect(
      bed.events.events.map((event) => [event.type, 'moderated' in event && event.moderated]),
    ).toEqual([
      ['collaboration.comment_deleted', false],
      ['collaboration.comment_deleted', true],
    ]);
  });

  it('works on an archived project and a canceled task; a viewer gets 403 even on a removed one', async () => {
    const { bed, web } = world();
    const view = await create(bed, 'bia', 'senha: 123');
    web.archived = true;
    web.canceled = true;

    expect(await code(remove(bed, 'vivi', view.id))).toBe('INSUFFICIENT_ROLE');
    expect(await code(remove(bed, 'bia', view.id, 9))).toBe('VERSION_CONFLICT');
    expect(await code(remove(bed, 'bia', view.id))).toBe('ok');
    expect(await code(remove(bed, 'vivi', view.id))).toBe('INSUFFICIENT_ROLE');
    expect(await code(remove(bed, 'otto', view.id))).toBe('COMMENT_NOT_FOUND');
  });
});

describe('ListMentionCandidates (RF-08)', () => {
  const candidates = (
    bed: CollaborationTestbed,
    person: Person,
    query: { query: string; cursor?: string | null; limit?: number; taskId?: string },
  ) => new ListMentionCandidatesUseCase(bed).execute(as(person), { taskId: TASK, ...query });

  it('lists readers of the project by name or e-mail, without the user, by cursor bound to the task and text', async () => {
    const { bed } = world();

    const first = await candidates(bed, 'bia', { query: 'i', limit: 2 });
    const next = await candidates(bed, 'bia', { query: 'i', limit: 2, cursor: first.nextCursor });

    expect(first.items.map((item) => item.name)).toEqual(['Caio', 'Mia']);
    expect(next.items.map((item) => item.name)).toEqual(['Vivi']);
    expect(bed.discussion.searches[0]).toMatchObject({
      projectId: WEB,
      excludeUserId: id('bia'),
      cursor: null,
    });
    expect(await code(candidates(bed, 'bia', { query: 'a', cursor: first.nextCursor }))).toBe(
      'INVALID_CURSOR',
    );
    expect(
      await code(
        candidates(bed, 'bia', { query: 'i', taskId: OTHER_TASK, cursor: first.nextCursor }),
      ),
    ).toBe('INVALID_CURSOR');
  });

  it('only for who can comment; no access is 404; too many readers is 422; limited per minute', async () => {
    const { bed } = world();
    expect(await code(candidates(bed, 'vivi', { query: 'a' }))).toBe('INSUFFICIENT_ROLE');
    expect(await code(candidates(bed, 'otto', { query: 'a' }))).toBe('TASK_NOT_FOUND');
    bed.discussion.tooManyReaders = true;
    expect(await code(candidates(bed, 'bia', { query: 'a' }))).toBe('TOO_MANY_READERS');
    bed.rateLimiter.consumed.set(
      `${MENTION_SEARCH_POLICY.name}|${id('bia')}`,
      MENTION_SEARCH_POLICY.points,
    );
    expect(await code(candidates(bed, 'bia', { query: 'a' }))).toBe('RATE_LIMITED');
  });
});
