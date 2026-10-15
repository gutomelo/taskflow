import { CommentDeletedError } from '../errors';
import { Comment } from './comment';
import { parseCommentBody } from './comment-content';

const ANA = '0192a000-0000-7000-8000-00000000a0a0';
const BIA = '0192a000-0000-7000-8000-00000000b1b1';
const VIVI = '0192a000-0000-7000-8000-00000000c2c2';
const OWNER = '0192a000-0000-7000-8000-00000000d3d3';
const T0 = new Date('2026-10-14T10:00:00.000Z');
const T1 = new Date('2026-10-14T11:00:00.000Z');

const content = (raw: string) => parseCommentBody(raw, ANA);

function commentBy(raw: string) {
  return Comment.create({
    id: 'c-1',
    organizationId: 'org-a',
    projectId: 'p-1',
    taskId: 't-1',
    authorUserId: ANA,
    content: content(raw),
    now: T0,
  });
}

describe('BR-031: comment lifecycle', () => {
  it('is created at version 1 with its text and mentions', () => {
    expect(commentBy(`Oi <@${BIA}>`).snapshot()).toEqual({
      id: 'c-1',
      organizationId: 'org-a',
      projectId: 'p-1',
      taskId: 't-1',
      authorUserId: ANA,
      body: `Oi <@${BIA}>`,
      mentionedUserIds: [BIA],
      createdAt: T0,
      editedAt: null,
      deletedAt: null,
      deletedByUserId: null,
      version: 1,
    });
  });

  it('BR-032: editing replaces text and mentions and reports only the new ones', () => {
    const comment = commentBy(`<@${BIA}> e <@${VIVI}>`);

    const edit = comment.edit(content(`<@${BIA}> e <@${OWNER}>`), T1);

    expect(edit).toEqual({ changed: true, addedMentionUserIds: [OWNER] });
    expect(comment.snapshot()).toMatchObject({
      body: `<@${BIA}> e <@${OWNER}>`,
      mentionedUserIds: [BIA, OWNER],
      editedAt: T1,
    });
  });

  it('D10: the mentions a new text would add are computed against the current set', () => {
    const comment = commentBy(`<@${BIA}>`);
    expect(comment.newMentionsIn(content(`<@${BIA}> <@${VIVI}>`))).toEqual([VIVI]);
    expect(comment.newMentionsIn(content('sem menções'))).toEqual([]);
  });

  it('editing to the same text changes nothing', () => {
    const comment = commentBy(`Oi <@${BIA}>`);
    expect(comment.edit(content(`  Oi <@${BIA.toUpperCase()}>  `), T1)).toEqual({
      changed: false,
      addedMentionUserIds: [],
    });
    expect(comment.snapshot().editedAt).toBeNull();
  });

  it('removing every mention leaves none and reports none', () => {
    const comment = commentBy(`<@${BIA}>`);
    expect(comment.edit(content('sem menções'), T1)).toEqual({
      changed: true,
      addedMentionUserIds: [],
    });
    expect(comment.mentionedUserIds).toEqual([]);
  });

  it('D4: deleting erases text and mentions, once', () => {
    const comment = commentBy(`<@${BIA}>`);

    expect(comment.delete(OWNER, T1)).toBe(true);
    expect(comment.snapshot()).toMatchObject({
      body: null,
      mentionedUserIds: [],
      deletedAt: T1,
      deletedByUserId: OWNER,
      authorUserId: ANA,
    });
    expect(comment.isDeleted).toBe(true);
    expect(comment.delete(ANA, new Date('2026-10-15T00:00:00.000Z'))).toBe(false);
    expect(comment.snapshot()).toMatchObject({ deletedAt: T1, deletedByUserId: OWNER });
  });

  it('a removed comment cannot be edited', () => {
    const comment = commentBy('texto');
    comment.delete(ANA, T1);
    expect(() => comment.edit(content('outro'), T1)).toThrow(CommentDeletedError);
  });
});
