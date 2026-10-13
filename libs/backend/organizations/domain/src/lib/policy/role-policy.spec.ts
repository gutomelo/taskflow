import { ORGANIZATION_ROLES, type OrganizationRole } from '@taskflow/backend/shared/kernel';
import { canChangeRole, canInvite, canRemove, memberActions } from './role-policy';

/**
 * Oráculo independente da BR-021 (matriz de `docs/security/authorization.md`), escrito de forma
 * diferente da implementação para que um erro comum aos dois não passe despercebido.
 */
function expectedChangeRole(
  actor: OrganizationRole,
  target: OrganizationRole,
  newRole: OrganizationRole,
  isSelf: boolean,
): boolean {
  if (isSelf) return actor === 'owner'; // só o owner se rebaixa (target === actor quando isSelf)
  const touchesOwner = target === 'owner' || newRole === 'owner';
  if (touchesOwner) return actor === 'owner';
  return actor === 'owner' || actor === 'admin';
}

const combinations = ORGANIZATION_ROLES.flatMap((actor) =>
  ORGANIZATION_ROLES.flatMap((target) =>
    ORGANIZATION_ROLES.map((newRole) => [actor, target, newRole] as const),
  ),
);

describe('role policy (BR-021)', () => {
  it.each(combinations)(
    'BR-021: %s changing a %s to %s (another member)',
    (actor, target, newRole) => {
      expect(canChangeRole({ actor, target, newRole, isSelf: false })).toBe(
        expectedChangeRole(actor, target, newRole, false),
      );
    },
  );

  it.each(ORGANIZATION_ROLES)('BR-021: a %s changing their own role', (role) => {
    for (const newRole of ORGANIZATION_ROLES) {
      expect(canChangeRole({ actor: role, target: role, newRole, isSelf: true })).toBe(
        expectedChangeRole(role, role, newRole, true),
      );
    }
  });

  it.each(
    ORGANIZATION_ROLES.flatMap((actor) =>
      ORGANIZATION_ROLES.map((target) => [actor, target] as const),
    ),
  )('BR-021: %s removing a %s', (actor, target) => {
    const expected = actor === 'owner' || (actor === 'admin' && target !== 'owner');
    expect(canRemove({ actor, target, isSelf: false })).toBe(expected);
  });

  it('lets anyone leave (the last-owner rule is enforced with the owner count)', () => {
    for (const role of ORGANIZATION_ROLES) {
      expect(canRemove({ actor: role, target: role, isSelf: true })).toBe(true);
    }
  });

  it.each(
    ORGANIZATION_ROLES.flatMap((actor) => ORGANIZATION_ROLES.map((role) => [actor, role] as const)),
  )('BR-021: %s inviting as %s', (actor, role) => {
    expect(canInvite(actor, role)).toBe(
      (actor === 'owner' || actor === 'admin') && role !== 'owner',
    );
  });

  describe('memberActions (spec 006, capacidades)', () => {
    it.each([
      ['owner', 'member', false, ['owner', 'admin', 'viewer'], true],
      ['owner', 'owner', false, ['admin', 'member', 'viewer'], true],
      ['owner', 'owner', true, ['admin', 'member', 'viewer'], false],
      ['admin', 'member', false, ['admin', 'viewer'], true],
      ['admin', 'owner', false, [], false],
      ['admin', 'admin', true, [], false],
      ['member', 'viewer', false, [], false],
      ['viewer', 'member', false, [], false],
    ] as const)(
      '%s acting on %s (self: %s) ⇒ changeRoleTo %j, remove %s',
      (actor, target, isSelf, roles, remove) => {
        expect(memberActions({ actor, target, isSelf })).toEqual({ changeRoleTo: roles, remove });
      },
    );
  });
});
