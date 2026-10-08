import { UuidV7Generator } from './uuid-v7-generator';

describe('UuidV7Generator', () => {
  const generator = new UuidV7Generator();

  it('generates RFC 9562 version 7 UUIDs', () => {
    expect(generator.generate()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('produces ids that sort in creation order', () => {
    const ids = Array.from({ length: 1000 }, () => generator.generate());

    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
