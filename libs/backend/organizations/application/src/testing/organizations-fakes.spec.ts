import { EmailAddress } from '@taskflow/backend/shared/kernel';
import { MAX_USER_ACCOUNTS_PER_QUERY } from '../lib/ports/user-directory';
import { InMemoryUserDirectory } from './organizations-fakes';

describe('InMemoryUserDirectory', () => {
  const ana = { id: 'u-ana', name: 'Ana', email: 'ana@exemplo.com', emailVerified: true };

  it('behaves like the identity adapter: indexed by id, unknown ids left out', async () => {
    const directory = new InMemoryUserDirectory();
    directory.add(ana);

    const found = await directory.getAccounts(['u-ana', 'ghost']);

    expect([...found.keys()]).toEqual(['u-ana']);
    expect(found.get('u-ana')).toEqual(ana);
    expect(await directory.findUserIdByEmail(EmailAddress.create(' ANA@exemplo.com'))).toBe(
      'u-ana',
    );
    expect(await directory.findUserIdByEmail(EmailAddress.create('outra@exemplo.com'))).toBeNull();
  });

  it('enforces the same per-query cap as identity', async () => {
    const directory = new InMemoryUserDirectory();
    const ids = Array.from({ length: MAX_USER_ACCOUNTS_PER_QUERY + 1 }, (_, i) => `id-${i}`);

    await expect(directory.getAccounts(ids)).rejects.toBeInstanceOf(RangeError);
  });
});
