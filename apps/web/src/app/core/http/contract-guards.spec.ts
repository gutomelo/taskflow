import { isCurrentUser, isProblemDetails } from './contract-guards';

const user = {
  id: '01a11e1a-99fa-7501-a131-4ad99a122005',
  name: 'Ana',
  email: 'ana@exemplo.com',
  emailVerified: false,
};

describe('contract guards', () => {
  it('accepts a current user that matches the contract', () => {
    expect(isCurrentUser(user)).toBe(true);
  });

  it.each([
    ['non-UUID id', { ...user, id: 'user-1' }],
    ['missing flag', { id: user.id, name: 'Ana', email: 'ana@exemplo.com' }],
    ['wrong type', { ...user, emailVerified: 'yes' }],
    ['array', [user]],
    ['null', null],
  ])('rejects a current user with %s', (_case, value) => {
    expect(isCurrentUser(value)).toBe(false);
  });

  it('accepts Problem Details with or without violations', () => {
    const problem = { type: 'about:blank', title: 'x', status: 422, code: 'X' };
    expect(isProblemDetails(problem)).toBe(true);
    expect(isProblemDetails({ ...problem, violations: [{ field: 'f', message: 'm' }] })).toBe(true);
  });

  it.each([
    ['HTML body', '<html>Bad Gateway</html>'],
    ['missing code', { type: 'about:blank', title: 'x', status: 500 }],
    ['malformed violations', { type: 'x', title: 'x', status: 400, code: 'X', violations: [1] }],
  ])('rejects %s as Problem Details', (_case, value) => {
    expect(isProblemDetails(value)).toBe(false);
  });
});
