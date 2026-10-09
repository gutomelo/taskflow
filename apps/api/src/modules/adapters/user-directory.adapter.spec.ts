import { EmailAddress } from '@taskflow/backend/shared/kernel';
import { PersonName, User } from '@taskflow/backend/identity/domain';
import {
  FindUserIdByEmailUseCase,
  GetUserAccountsUseCase,
  MAX_ACCOUNTS_PER_QUERY,
} from '@taskflow/backend/identity/application';
import { createIdentityTestbed } from '@taskflow/backend/identity/application/testing';
import { MAX_USER_ACCOUNTS_PER_QUERY } from '@taskflow/backend/organizations/application';
import { createUserDirectory } from './user-directory.adapter';

describe('UserDirectory adapter (organizations → identity)', () => {
  async function setup() {
    const bed = createIdentityTestbed();
    const ana = User.register({
      id: bed.idGenerator.generate(),
      email: EmailAddress.create('ana@exemplo.com'),
      name: PersonName.create('Ana Souza'),
      passwordHash: 'fake-hash:x',
      now: bed.clock.now(),
    });
    await bed.users.add(ana);
    const directory = createUserDirectory({
      userAccounts: new GetUserAccountsUseCase(bed),
      userIdByEmail: new FindUserIdByEmailUseCase(bed),
    });
    return { ana, directory };
  }

  it('indexes the identity accounts by id and finds ids by e-mail', async () => {
    const { ana, directory } = await setup();

    const accounts = await directory.getAccounts([ana.id, 'ghost']);

    expect([...accounts.entries()]).toEqual([
      [ana.id, { id: ana.id, name: 'Ana Souza', email: 'ana@exemplo.com', emailVerified: false }],
    ]);
    expect(await directory.findUserIdByEmail(EmailAddress.create('ANA@exemplo.com'))).toBe(ana.id);
  });

  it('keeps the per-query cap of both contexts aligned', () => {
    expect(MAX_USER_ACCOUNTS_PER_QUERY).toBe(MAX_ACCOUNTS_PER_QUERY);
  });
});
