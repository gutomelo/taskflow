import { DomainError } from './domain-error';

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
});
