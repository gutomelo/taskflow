import { isWorkflow } from './projects-contract-guards';

const status = {
  id: '0192a000-0000-7000-8000-000000000501',
  name: 'A fazer',
  category: 'todo',
  position: 0,
  inUse: false,
};

describe('isWorkflow (spec 005: version and inUse)', () => {
  it('accepts the workflow with its version and the in-use flag of each status', () => {
    expect(isWorkflow({ version: 1, statuses: [status], transitions: [] })).toBe(true);
  });

  it('refuses a workflow without version or a status without inUse', () => {
    expect(isWorkflow({ statuses: [status], transitions: [] })).toBe(false);
    const { inUse: _inUse, ...withoutFlag } = status;
    expect(isWorkflow({ version: 1, statuses: [withoutFlag], transitions: [] })).toBe(false);
    expect(
      isWorkflow({ version: 1, statuses: [{ ...status, inUse: 'no' }], transitions: [] }),
    ).toBe(false);
  });
});
