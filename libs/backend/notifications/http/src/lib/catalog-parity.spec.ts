import * as application from '@taskflow/backend/notifications/application';
import * as domain from '@taskflow/backend/notifications/domain';
import { NOTIFICATION_KINDS } from '@taskflow/backend/notifications/domain';
import { DomainError } from '@taskflow/backend/shared/kernel';
import { notificationKindSchema } from '@taskflow/contracts';
import { notificationsErrorMappings } from './notifications-error-mappings';

describe('notifications catalog parity (domain × contracts × HTTP)', () => {
  it('keeps the kinds identical', () => {
    expect([...notificationKindSchema.options]).toEqual([...NOTIFICATION_KINDS]);
  });

  it('maps every error code of the context to an explicit HTTP status', () => {
    const codes: string[] = [];
    for (const exported of [...Object.values(domain), ...Object.values(application)]) {
      if (typeof exported !== 'function' || !(exported.prototype instanceof DomainError)) continue;
      const instance: unknown = Reflect.construct(exported, []);
      if (instance instanceof DomainError) codes.push(instance.code);
    }
    expect(codes.sort()).toEqual(['INVALID_CURSOR', 'NOTIFICATION_NOT_FOUND']);
    expect(codes.filter((code) => !(code in notificationsErrorMappings))).toEqual([]);
  });
});
