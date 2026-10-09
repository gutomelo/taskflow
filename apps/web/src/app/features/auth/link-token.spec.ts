import { TestBed } from '@angular/core/testing';
import { LinkToken } from './link-token';

describe('LinkToken', () => {
  const token = 'abcDEF123_-abcDEF123_-abcDEF123_-abcDEF12';

  afterEach(() => history.replaceState(null, '', '/'));

  function take(url: string): string | null {
    history.replaceState(null, '', url);
    return TestBed.inject(LinkToken).takeFromFragment();
  }

  it('reads the token from the fragment and removes it from the address bar', () => {
    expect(take(`/verify-email?utm=x#token=${token}`)).toBe(token);

    expect(location.hash).toBe('');
    expect(location.pathname + location.search).toBe('/verify-email?utm=x');
  });

  it.each([
    ['too short', '#token=abc'],
    ['invalid characters', `#token=${token}<script>`],
    ['another parameter', `#other=${token}`],
  ])('discards a fragment with %s, still clearing the URL', (_case, fragment) => {
    expect(take(`/reset-password${fragment}`)).toBeNull();
    expect(location.hash).toBe('');
  });

  it('returns null when there is no fragment', () => {
    expect(take('/verify-email')).toBeNull();
  });
});
