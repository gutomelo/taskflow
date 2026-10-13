import {
  addProjectMemberRequestSchema,
  createProjectRequestSchema,
  projectListQuerySchema,
  updateProjectRequestSchema,
} from './projects.contract';

describe('projects contracts (spec 003)', () => {
  it('commands reject unknown fields, including organizationId (mass assignment)', () => {
    expect(
      createProjectRequestSchema.safeParse({ key: 'WEB', name: 'Website', organizationId: 'x' })
        .success,
    ).toBe(false);
    expect(
      addProjectMemberRequestSchema.safeParse({
        userId: '0192a000-0000-7000-8000-000000000001',
        role: 'member',
        organizationId: 'x',
      }).success,
    ).toBe(false);
  });

  it('an update needs at least one field and the version; the key cannot be changed', () => {
    expect(updateProjectRequestSchema.safeParse({ version: 1 }).success).toBe(false);
    expect(updateProjectRequestSchema.safeParse({ key: 'NEW', version: 1 }).success).toBe(false);
    expect(updateProjectRequestSchema.safeParse({ description: null, version: 1 }).success).toBe(
      true,
    );
  });

  it('a participant is referenced by a UUID with a known project role', () => {
    expect(addProjectMemberRequestSchema.safeParse({ userId: 'ana', role: 'member' }).success).toBe(
      false,
    );
    expect(
      addProjectMemberRequestSchema.safeParse({
        userId: '0192a000-0000-7000-8000-000000000001',
        role: 'owner',
      }).success,
    ).toBe(false);
  });

  it('lists active projects unless archived is asked explicitly', () => {
    expect(projectListQuerySchema.parse({})).toEqual({});
    expect(projectListQuerySchema.parse({ status: 'archived', limit: '10' })).toEqual({
      status: 'archived',
      limit: 10,
    });
    expect(projectListQuerySchema.safeParse({ status: 'all' }).success).toBe(false);
  });
});
