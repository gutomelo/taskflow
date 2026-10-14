import {
  createTaskRequestSchema,
  taskKeyParamSchema,
  taskListQuerySchema,
  updateTaskRequestSchema,
} from './tasks.contract';

const ID = '0192a000-0000-7000-8000-000000000001';

describe('tasks contracts (spec 004)', () => {
  it('commands reject unknown fields: organizationId, number, statusId, completedAt, createdByUserId', () => {
    for (const extra of [
      'organizationId',
      'number',
      'statusId',
      'completedAt',
      'createdByUserId',
    ]) {
      expect(
        createTaskRequestSchema.safeParse({ projectId: ID, title: 'X', [extra]: 'x' }).success,
      ).toBe(false);
    }
    expect(createTaskRequestSchema.safeParse({ projectId: ID, title: 'X' }).success).toBe(true);
  });

  it('an update needs at least one field and the version', () => {
    expect(updateTaskRequestSchema.safeParse({ version: 1 }).success).toBe(false);
    expect(updateTaskRequestSchema.safeParse({ title: 'X' }).success).toBe(false);
    expect(updateTaskRequestSchema.safeParse({ dueDate: null, version: 1 }).success).toBe(true);
    expect(updateTaskRequestSchema.safeParse({ isRequired: false, version: 1 }).success).toBe(true);
  });

  it('M6.1: the person filter only takes UUIDs; "me" and "nobody" live in assigned', () => {
    expect(taskListQuerySchema.safeParse({ projectId: ID, assigneeUserId: 'me' }).success).toBe(
      false,
    );
    expect(taskListQuerySchema.parse({ projectId: ID, assigned: 'me', canceled: 'true' })).toEqual({
      projectId: ID,
      assigned: 'me',
      canceled: true,
    });
    expect(taskListQuerySchema.safeParse({ projectId: ID, canceled: 'yes' }).success).toBe(false);
    expect(taskListQuerySchema.safeParse({}).success).toBe(false);
  });

  it('BR-028: task keys are KEY-N', () => {
    expect(taskKeyParamSchema.safeParse({ key: 'WEB-42' }).success).toBe(true);
    for (const key of ['web-1', 'WEB-0', 'WEB-01', 'W-1', 'WEB', 'WEB-1234567890']) {
      expect(taskKeyParamSchema.safeParse({ key }).success).toBe(false);
    }
  });
});
