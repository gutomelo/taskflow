import { toSessionClient } from './client-info';

describe('toSessionClient', () => {
  it.each([
    ['203.0.113.77', '203.0.113.0/24'],
    ['::ffff:203.0.113.77', '203.0.113.0/24'],
    ['2001:db8:1:2:aaaa::1', '2001:0db8:0001:0002::/64'],
    ['::1', '0000:0000:0000:0000::/64'],
    ['not-an-ip', null],
  ])('keeps only the network prefix of %s', (ipAddress, expected) => {
    expect(toSessionClient({ ipAddress, userAgent: null }).ipPrefix).toBe(expected);
  });

  it('handles missing client data', () => {
    expect(toSessionClient({ ipAddress: null, userAgent: null })).toEqual({
      ipPrefix: null,
      userAgent: null,
    });
  });
});
