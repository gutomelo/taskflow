import {
  canOnProject,
  effectiveProjectRole,
  hasOrganizationPermission,
  isOrganizationPermission,
  isProjectRole,
  ORGANIZATION_PERMISSIONS,
  organizationGrant,
  organizationPermissions,
  PROJECT_PERMISSIONS,
  PROJECT_ROLES,
  projectGrant,
} from './authorization';
import { ORGANIZATION_ROLES } from '../organization/organization-role';

// Transcrição literal de docs/security/authorization.md (não derivada da matriz implementada).
// Organização — colunas: owner, admin, member, viewer. `setting` = "² configurável" (BR-024);
// `member:remove` = remover outros ("sair" não é permissão).
const ORGANIZATION_DOC = {
  'organization:read': ['allow', 'allow', 'allow', 'allow'],
  'organization:update': ['allow', 'allow', 'deny', 'deny'],
  'member:invite': ['allow', 'allow', 'deny', 'deny'],
  'member:change-role': ['allow', 'allow', 'deny', 'deny'],
  'member:remove': ['allow', 'allow', 'deny', 'deny'],
  'project:create': ['allow', 'allow', 'setting', 'deny'],
} as const;

// Projeto — colunas: manager, member, viewer. `own` = "⚪ só o próprio recurso".
const PROJECT_DOC = {
  'project:read': ['allow', 'allow', 'allow'],
  'project:update': ['allow', 'deny', 'deny'],
  'project:archive': ['allow', 'deny', 'deny'],
  'project-member:manage': ['allow', 'deny', 'deny'],
  'task:create': ['allow', 'allow', 'deny'],
  'task:update': ['allow', 'allow', 'deny'],
  'task:assign': ['allow', 'allow', 'deny'],
  'task:delete': ['allow', 'own', 'deny'],
  'comment:create': ['allow', 'allow', 'deny'],
  'comment:update': ['own', 'own', 'deny'],
  'comment:delete': ['allow', 'own', 'deny'],
  'sprint:manage': ['allow', 'deny', 'deny'],
  'board:configure': ['allow', 'deny', 'deny'],
} as const;

const ORG_ROLES = ['owner', 'admin', 'member', 'viewer'] as const;
const PRJ_ROLES = ['manager', 'member', 'viewer'] as const;

describe('authorization kernel (spec 006, ADR 0013)', () => {
  it('covers exactly the documented catalogs and roles', () => {
    expect([...ORGANIZATION_PERMISSIONS].sort()).toEqual(Object.keys(ORGANIZATION_DOC).sort());
    expect([...PROJECT_PERMISSIONS].sort()).toEqual(Object.keys(PROJECT_DOC).sort());
    expect([...ORGANIZATION_ROLES]).toEqual([...ORG_ROLES]);
    expect([...PROJECT_ROLES]).toEqual([...PRJ_ROLES]);
  });

  describe('CA-01: organization matrix', () => {
    const cases = Object.entries(ORGANIZATION_DOC).flatMap(([permission, grants]) =>
      ORG_ROLES.map((role, index) => [role, permission, grants[index]] as const),
    );
    it.each(cases)('%s × %s ⇒ %s', (role, permission, expected) => {
      expect(organizationGrant(role, permission)).toBe(expected);
    });
  });

  describe('CA-01: project matrix', () => {
    const cases = Object.entries(PROJECT_DOC).flatMap(([permission, grants]) =>
      PRJ_ROLES.map((role, index) => [role, permission, grants[index]] as const),
    );
    it.each(cases)('%s × %s ⇒ %s', (role, permission, expected) => {
      expect(projectGrant(role, permission)).toBe(expected);
    });
  });

  describe('RNF-01: default deny', () => {
    const hostile = [
      'constructor',
      '__proto__',
      'toString',
      'hasOwnProperty',
      'project:delete',
      '',
      'ORGANIZATION:READ',
    ];

    it.each(hostile)('denies the unknown permission %j for every role', (permission) => {
      for (const role of ORG_ROLES) expect(organizationGrant(role, permission)).toBe('deny');
      for (const role of PRJ_ROLES) expect(projectGrant(role, permission)).toBe('deny');
      expect(isOrganizationPermission(permission)).toBe(false);
    });

    it.each(['superuser', 'constructor', '__proto__', null, undefined, 1])(
      'denies the unknown role %j',
      (role) => {
        expect(organizationGrant(role, 'organization:read')).toBe('deny');
        expect(projectGrant(role, 'project:read')).toBe('deny');
        expect(isProjectRole(role)).toBe(false);
        expect(hasOrganizationPermission(role, 'organization:read')).toBe(false);
      },
    );

    it('treats "setting" as not allowed unless resolved with the settings', () => {
      expect(hasOrganizationPermission('member', 'project:create')).toBe(false);
    });
  });

  describe('BR-024: organization permissions with settings', () => {
    it('resolves project:create for members from the setting', () => {
      expect(organizationPermissions('member', { membersCanCreateProjects: true })).toEqual([
        'organization:read',
        'project:create',
      ]);
      expect(organizationPermissions('member', { membersCanCreateProjects: false })).toEqual([
        'organization:read',
      ]);
    });

    it('keeps project:create for owners and admins and never gives it to viewers', () => {
      for (const enabled of [true, false]) {
        const settings = { membersCanCreateProjects: enabled };
        expect(organizationPermissions('owner', settings)).toContain('project:create');
        expect(organizationPermissions('admin', settings)).toContain('project:create');
        expect(organizationPermissions('viewer', settings)).toEqual(['organization:read']);
      }
    });
  });

  describe('CA-02 / BR-023: effective project role', () => {
    it.each([
      ['owner', null, 'manager'],
      ['owner', 'viewer', 'manager'],
      ['admin', null, 'manager'],
      ['member', 'manager', 'manager'],
      ['member', 'viewer', 'viewer'],
      ['member', null, null],
      ['viewer', 'manager', 'viewer'],
      ['viewer', 'member', 'viewer'],
      ['viewer', 'viewer', 'viewer'],
      ['viewer', null, null],
    ] as const)(
      'organization %s with project role %s ⇒ %s',
      (organizationRole, projectRole, expected) => {
        expect(effectiveProjectRole(organizationRole, projectRole)).toBe(expected);
      },
    );

    it.each(['owner-of-project', 'MEMBER', '__proto__', 'constructor', 42, undefined])(
      'an unknown project role (%s) counts as no participation for members and viewers',
      (projectRole) => {
        expect(effectiveProjectRole('member', projectRole)).toBeNull();
        expect(effectiveProjectRole('viewer', projectRole)).toBeNull();
      },
    );
  });

  describe('canOnProject', () => {
    it('grants "own" only to the owner of the resource', () => {
      expect(canOnProject('member', 'task:delete', { ownsResource: true })).toBe(true);
      expect(canOnProject('member', 'task:delete', { ownsResource: false })).toBe(false);
      expect(canOnProject('manager', 'task:delete', { ownsResource: false })).toBe(true);
      expect(canOnProject('manager', 'comment:update', { ownsResource: false })).toBe(false);
    });

    it('denies everything without an effective role (no access ⇒ 404)', () => {
      for (const permission of PROJECT_PERMISSIONS) {
        expect(canOnProject(null, permission, { ownsResource: true })).toBe(false);
      }
    });

    it('a viewer cannot even edit its own comments', () => {
      expect(canOnProject('viewer', 'comment:update', { ownsResource: true })).toBe(false);
    });
  });
});
