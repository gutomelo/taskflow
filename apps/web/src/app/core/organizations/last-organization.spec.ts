import { LastOrganizationStorage } from './last-organization';

describe('LastOrganizationStorage', () => {
  beforeEach(() => localStorage.clear());

  it('remembers the slug only for the same user', () => {
    const storage = new LastOrganizationStorage();
    storage.write('user-a', 'acme');

    expect(storage.read('user-a')).toBe('acme');
    expect(storage.read('user-b')).toBeNull();
    storage.clear();
    expect(storage.read('user-a')).toBeNull();
  });

  it('ignores corrupted values and storage that throws', () => {
    const storage = new LastOrganizationStorage();
    localStorage.setItem('tf.lastOrganization', '{nao json');
    expect(storage.read('user-a')).toBeNull();

    const failing = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(storage.read('user-a')).toBeNull();
    failing.mockRestore();
  });

  it('never stores anything but the user id and the slug', () => {
    new LastOrganizationStorage().write('user-a', 'acme');

    expect(JSON.parse(localStorage.getItem('tf.lastOrganization') ?? '{}')).toEqual({
      userId: 'user-a',
      slug: 'acme',
    });
  });
});
