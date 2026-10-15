import { defaultWorkflow } from './workflow';

describe('defaultWorkflow (BR-004, default part)', () => {
  it('creates "A fazer" → "Em andamento" → "Concluído" with back transitions between neighbours', () => {
    let next = 0;
    const workflow = defaultWorkflow(() => `s-${(next += 1)}`);

    expect(workflow.statuses).toEqual([
      { id: 's-1', name: 'A fazer', category: 'todo', position: 0 },
      { id: 's-2', name: 'Em andamento', category: 'in_progress', position: 1 },
      { id: 's-3', name: 'Concluído', category: 'done', position: 2 },
    ]);
    expect(workflow.transitions).toEqual([
      { fromStatusId: 's-1', toStatusId: 's-2' },
      { fromStatusId: 's-2', toStatusId: 's-1' },
      { fromStatusId: 's-2', toStatusId: 's-3' },
      { fromStatusId: 's-3', toStatusId: 's-2' },
    ]);
  });
});
