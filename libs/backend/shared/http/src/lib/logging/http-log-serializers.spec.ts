import type { IncomingMessage, ServerResponse } from 'node:http';
import { httpLogSerializers } from './http-log-serializers';

describe('httpLogSerializers', () => {
  it('keeps only method, path, id and user agent from requests', () => {
    const incoming = {
      id: 'req-1',
      method: 'POST',
      url: '/api/v1/auth/password/reset?token=secret-link-token',
      headers: {
        cookie: '__Host-tf_at=jwt; __Secure-tf_rt=refresh',
        authorization: 'Bearer abc',
        'x-csrf-token': 'csrf-value',
        'x-forwarded-for': '203.0.113.7',
        'user-agent': 'Mozilla/5.0',
      },
    } as unknown as IncomingMessage; // Fixture parcial: o serializer lê apenas estes campos.

    const serialized = httpLogSerializers.req(incoming);

    expect(serialized).toEqual({
      id: 'req-1',
      method: 'POST',
      path: '/api/v1/auth/password/reset',
      userAgent: 'Mozilla/5.0',
    });
    expect(JSON.stringify(serialized)).not.toMatch(
      /secret-link-token|jwt|refresh|csrf-value|203\.0\.113\.7/,
    );
  });

  it('keeps only the status code from responses', () => {
    const response = {
      statusCode: 201,
      getHeaders: () => ({ 'set-cookie': 'x' }),
    } as unknown as ServerResponse;

    expect(httpLogSerializers.res(response)).toEqual({ statusCode: 201 });
  });
});
