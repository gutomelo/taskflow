import { createCollaborationUserDirectory } from './collaboration-user-directory.adapter';
import { createTaskDiscussionAccess } from './task-discussion-access.adapter';

const unused = { execute: async () => null };

function discussionWith(readers: Readonly<{ userIds: string[]; complete: boolean }>) {
  const searched: Array<readonly string[]> = [];
  const access = createTaskDiscussionAccess({
    tasks: { discussion: { lockForComment: unused, resolveForRead: unused } },
    projects: { contribution: { readerIds: { execute: async () => readers } } },
    identity: {
      searchUsersAmong: {
        execute: async (userIds: readonly string[]) => {
          searched.push(userIds);
          return {
            items: userIds.map((id) => ({
              id,
              name: id.toUpperCase(),
              email: `${id}@x.com`,
              emailVerified: true,
            })),
            nextCursor: 'next',
          };
        },
      },
    },
  });
  return { access, searched };
}

describe('collaboration adapters (spec 010)', () => {
  it('candidates: readers of the project without the user, mapped to the port', async () => {
    const { access, searched } = discussionWith({ userIds: ['ana', 'bia'], complete: true });

    const page = await access.mentionCandidates('org', 'p', {
      query: 'a',
      excludeUserId: 'bia',
      limit: 5,
      cursor: null,
    });

    expect(searched).toEqual([['ana']]);
    expect(page).toEqual({
      items: [{ userId: 'ana', name: 'ANA', email: 'ana@x.com' }],
      nextCursor: 'next',
    });
  });

  it('candidates: too many readers is null and nothing is searched', async () => {
    const { access, searched } = discussionWith({ userIds: ['ana'], complete: false });

    expect(
      await access.mentionCandidates('org', 'p', {
        query: 'a',
        excludeUserId: 'x',
        limit: 5,
        cursor: null,
      }),
    ).toBeNull();
    expect(searched).toEqual([]);
  });

  it('names: only current members, in batches of at most 100 accounts', async () => {
    const batches: number[] = [];
    const ids = Array.from({ length: 150 }, (_, index) => `u${index}`);
    const directory = createCollaborationUserDirectory({
      organizations: {
        access: {
          rolesOf: {
            execute: async (_organizationId: string, userIds: ReadonlyArray<string>) =>
              new Map(
                userIds
                  .filter((userId) => userId !== 'u0')
                  .map((userId) => [userId, 'member' as const]),
              ),
          },
        },
      },
      identity: {
        userAccounts: {
          execute: async (userIds: readonly string[]) => {
            batches.push(userIds.length);
            return userIds.map((id) => ({
              id,
              name: `N-${id}`,
              email: `${id}@x.com`,
              emailVerified: true,
            }));
          },
        },
      },
    });

    const names = await directory.displayNames('org', [...ids, 'u1']);

    expect(batches).toEqual([100, 49]);
    expect(names.size).toBe(149);
    expect(names.has('u0')).toBe(false);
    expect(names.get('u1')).toBe('N-u1');
    expect(await directory.displayNames('org', [])).toEqual(new Map());
  });
});
