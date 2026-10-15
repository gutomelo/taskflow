import { summarizeUserAgent } from './user-agent';

describe('summarizeUserAgent', () => {
  it.each([
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 Edg/141.0',
      'Edge',
      'Windows',
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15',
      'Safari',
      'macOS',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/141.0 Mobile/15E148 Safari/604.1',
      'Chrome',
      'iOS',
    ],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0', 'Firefox', 'Linux'],
    [
      'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/141.0 Safari/537.36 OPR/120.0',
      'Opera',
      'Windows',
    ],
  ])('recognizes %s', (userAgent, browser, os) => {
    expect(summarizeUserAgent(userAgent)).toEqual({ browser, os });
  });

  it('returns nulls for unknown or missing user agents', () => {
    expect(summarizeUserAgent('curl/8.5.0')).toEqual({ browser: null, os: null });
    expect(summarizeUserAgent(null)).toEqual({ browser: null, os: null });
  });
});
