import { EmailAddress } from '@taskflow/backend/shared/kernel';
import { PersonName, User } from '@taskflow/backend/identity/domain';
import { createIdentityTestbed, type IdentityTestbed } from '../../testing/identity-fakes';
import {
  FindUserIdByEmailUseCase,
  GetUserAccountsUseCase,
  MAX_ACCOUNTS_PER_QUERY,
} from './user-directory.use-cases';

async function addUser(bed: IdentityTestbed, email: string, name: string) {
  const user = User.register({
    id: bed.idGenerator.generate(),
    email: EmailAddress.create(email),
    name: PersonName.create(name),
    passwordHash: 'fake-hash:x',
    now: bed.clock.now(),
  });
  await bed.users.add(user);
  return user;
}

describe('GetUserAccountsUseCase (UserDirectory, spec 002)', () => {
  it('returns only public account fields, with the current verification status', async () => {
    const bed = createIdentityTestbed();
    const ana = await addUser(bed, 'ana@exemplo.com', 'Ana Souza');
    const bruno = await addUser(bed, 'bruno@exemplo.com', 'Bruno Lima');
    bruno.verifyEmail(bed.clock.now());
    await bed.users.save(bruno);

    const accounts = await new GetUserAccountsUseCase(bed).execute([ana.id, bruno.id]);

    expect(accounts).toHaveLength(2);
    expect(accounts).toEqual(
      expect.arrayContaining([
        { id: ana.id, name: 'Ana Souza', email: 'ana@exemplo.com', emailVerified: false },
        { id: bruno.id, name: 'Bruno Lima', email: 'bruno@exemplo.com', emailVerified: true },
      ]),
    );
    for (const account of accounts) {
      expect(Object.keys(account).sort()).toEqual(['email', 'emailVerified', 'id', 'name']);
    }
  });

  it('ignores unknown ids and duplicates, and skips the query for an empty list', async () => {
    const bed = createIdentityTestbed();
    const ana = await addUser(bed, 'ana@exemplo.com', 'Ana Souza');
    const accounts = new GetUserAccountsUseCase(bed);

    expect((await accounts.execute([ana.id, ana.id, 'ghost'])).map((a) => a.id)).toEqual([ana.id]);
    expect(await accounts.execute([])).toEqual([]);
  });

  it('rejects a query above the cap, counting distinct ids', async () => {
    const bed = createIdentityTestbed();
    const accounts = new GetUserAccountsUseCase(bed);
    const ids = Array.from({ length: MAX_ACCOUNTS_PER_QUERY }, (_, i) => `id-${i}`);

    await expect(accounts.execute([...ids, ids[0] ?? ''])).resolves.toEqual([]);
    await expect(accounts.execute([...ids, 'one-more'])).rejects.toBeInstanceOf(RangeError);
  });
});

describe('FindUserIdByEmailUseCase (UserDirectory, spec 002)', () => {
  it('finds the account id by normalized e-mail, or null', async () => {
    const bed = createIdentityTestbed();
    const ana = await addUser(bed, 'ana@exemplo.com', 'Ana Souza');
    const find = new FindUserIdByEmailUseCase(bed);

    expect(await find.execute(EmailAddress.create('  ANA@Exemplo.com '))).toBe(ana.id);
    expect(await find.execute(EmailAddress.create('outra@exemplo.com'))).toBeNull();
  });
});
