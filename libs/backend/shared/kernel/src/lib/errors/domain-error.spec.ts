import { DomainError } from './domain-error';
import { VersionConflictError } from './version-conflict-error';

class SampleRuleViolatedError extends DomainError {
  readonly code = 'SAMPLE_RULE_VIOLATED';

  constructor() {
    super('Sample rule violated');
  }
}

describe('DomainError', () => {
  it('keeps the subclass name and stable code', () => {
    const error = new SampleRuleViolatedError();

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('SampleRuleViolatedError');
    expect(error.code).toBe('SAMPLE_RULE_VIOLATED');
    expect(error.message).toBe('Sample rule violated');
  });

  it('VersionConflictError carries the stable VERSION_CONFLICT code and the entity name', () => {
    const error = new VersionConflictError('User');

    expect(error).toBeInstanceOf(DomainError);
    expect(error).toMatchObject({
      code: 'VERSION_CONFLICT',
      entity: 'User',
      name: 'VersionConflictError',
    });
  });
});
