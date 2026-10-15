import { isOrganizationRole, ORGANIZATION_ROLES } from './organization-role';

describe('isOrganizationRole', () => {
  it.each(ORGANIZATION_ROLES)('accepts %s', (role) => {
    expect(isOrganizationRole(role)).toBe(true);
  });

  it.each(['Owner', 'superadmin', '', null, undefined, 1, ['owner']])(
    'rejects %j (unknown roles never grant permissions)',
    (value) => {
      expect(isOrganizationRole(value)).toBe(false);
    },
  );
});
