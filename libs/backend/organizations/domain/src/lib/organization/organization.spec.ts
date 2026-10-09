import { Membership } from '../membership/membership';
import { Organization } from './organization';
import { OrganizationName } from './organization-name';
import { OrganizationSlug } from './organization-slug';

const T0 = new Date('2026-10-09T12:00:00.000Z');

describe('Organization and Membership', () => {
  it('starts at version 1 and renames without touching the slug (BR-022)', () => {
    const organization = Organization.create({
      id: 'org-1',
      name: OrganizationName.create('Acme'),
      slug: OrganizationSlug.create('acme'),
      now: T0,
    });
    organization.rename(OrganizationName.create('Acme Labs'), new Date(T0.getTime() + 1));

    expect(organization.version).toBe(1);
    expect(organization.toSnapshot()).toMatchObject({
      slug: { value: 'acme' },
      name: { value: 'Acme Labs' },
    });
  });

  it('snapshots contain only the declared fields (no input leaking into persisted state)', () => {
    const organization = Organization.create({
      id: 'org-1',
      name: OrganizationName.create('Acme'),
      slug: OrganizationSlug.create('acme'),
      now: T0,
    });
    const membership = Membership.create({
      id: 'm-1',
      organizationId: 'org-1',
      userId: 'ana',
      role: 'owner',
      now: T0,
    });

    expect(Object.keys(organization.toSnapshot()).sort()).toEqual([
      'createdAt',
      'id',
      'name',
      'slug',
      'updatedAt',
      'version',
    ]);
    expect(Object.keys(membership.toSnapshot()).sort()).toEqual([
      'createdAt',
      'id',
      'organizationId',
      'role',
      'updatedAt',
      'userId',
      'version',
    ]);
  });

  it('keeps the role on the membership and changes it explicitly', () => {
    const membership = Membership.create({
      id: 'm-1',
      organizationId: 'org-1',
      userId: 'ana',
      role: 'member',
      now: T0,
    });
    membership.changeRole('admin', T0);

    expect(membership.role).toBe('admin');
  });
});
