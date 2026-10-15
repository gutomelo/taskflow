import {
  changeMemberRoleRequestSchema,
  createOrganizationRequestSchema,
  invitationSchema,
  inviteMemberRequestSchema,
  pageQuerySchema,
  removeMemberQuerySchema,
} from './organizations.contract';

describe('organizations contracts', () => {
  it('rejects unknown fields in commands (mass assignment of tenant or role)', () => {
    expect(
      createOrganizationRequestSchema.safeParse({ name: 'Acme', slug: 'acme', ownerId: 'x' })
        .success,
    ).toBe(false);
    expect(
      changeMemberRoleRequestSchema.safeParse({ role: 'admin', version: 1, organizationId: 'x' })
        .success,
    ).toBe(false);
  });

  it('BR-021: never accepts owner as an invitation role', () => {
    expect(inviteMemberRequestSchema.safeParse({ email: 'a@b.co', role: 'owner' }).success).toBe(
      false,
    );
    expect(inviteMemberRequestSchema.safeParse({ email: 'a@b.co', role: 'admin' }).success).toBe(
      true,
    );
  });

  it('bounds pages to 1..100 and coerces query strings', () => {
    expect(pageQuerySchema.parse({ limit: '50' })).toEqual({ limit: 50 });
    expect(pageQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(pageQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(removeMemberQuerySchema.safeParse({}).success).toBe(false);
  });

  it('has no account-existence field on invitations (enumeration)', () => {
    expect(Object.keys(invitationSchema.shape).sort()).toEqual([
      'createdAt',
      'email',
      'expiresAt',
      'id',
      'invitedBy',
      'role',
      'status',
    ]);
  });
});
