import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EmailAddress } from '@taskflow/backend/shared/kernel';
import { Password, PasswordPolicyViolationError } from '@taskflow/backend/identity/domain';
import { FileCommonPasswordList } from './file-common-password-list';

const ASSET = join(import.meta.dirname, '../../assets/common-passwords.txt');

describe('FileCommonPasswordList', () => {
  it('loads the embedded list (NCSC top 100k, normalized and deduplicated)', async () => {
    const list = await FileCommonPasswordList.load(ASSET);

    expect(list.size).toBe(97_745);
    expect(list.contains('123456')).toBe(true);
  });

  it('matches case-insensitively and after NFC normalization', async () => {
    const list = await FileCommonPasswordList.load(ASSET);

    expect(list.contains('PASSWORD')).toBe(true);
    expect(list.contains('Qwerty')).toBe(true);
    expect(list.contains('Xq7!vR9#pL2m')).toBe(false);
  });

  it('BR-011: makes the domain reject composition-valid variants of common passwords', async () => {
    const list = await FileCommonPasswordList.load(ASSET);
    const variant = 'Password1!';
    expect(list.contains(variant)).toBe(true);

    expect(() =>
      Password.create(variant, {
        email: EmailAddress.create('ana@exemplo.com'),
        commonPasswords: list,
      }),
    ).toThrow(PasswordPolicyViolationError);
  });

  it('refuses to start with an empty list (would silently disable BR-011)', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'common-passwords-'));
    const emptyFile = join(directory, 'empty.txt');
    await writeFile(emptyFile, '\n');

    await expect(FileCommonPasswordList.load(emptyFile)).rejects.toThrow('empty');
  });
});
