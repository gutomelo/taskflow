import { assignableRoles, canRemoveMember } from './role-policy';

describe('role policy mirror (BR-021, UI only)', () => {
  it.each([
    ['owner', 'member', false, ['owner', 'admin', 'member', 'viewer']],
    ['owner', 'owner', true, ['owner', 'admin', 'member', 'viewer']],
    ['admin', 'member', false, ['admin', 'member', 'viewer']],
    ['admin', 'owner', false, ['owner']],
    ['admin', 'admin', true, ['admin']],
    ['member', 'viewer', false, ['viewer']],
    ['viewer', 'viewer', true, ['viewer']],
  ] as const)('%s changing %s (self: %s) may pick %j', (actor, target, isSelf, roles) => {
    expect(assignableRoles({ actor, target, isSelf })).toEqual(roles);
  });

  it.each([
    ['owner', 'owner', false, true],
    ['admin', 'member', false, true],
    ['admin', 'owner', false, false],
    ['member', 'viewer', false, false],
    ['owner', 'owner', true, false],
  ] as const)('%s removing %s (self: %s): %s', (actor, target, isSelf, allowed) => {
    expect(canRemoveMember({ actor, target, isSelf })).toBe(allowed);
  });
});
