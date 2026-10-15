import { TransitionNotAllowedError } from '../errors';
import {
  assertTransitionAllowed,
  initialStatus,
  transitionTargets,
  type WorkflowView,
} from './workflow';

const workflow: WorkflowView = {
  statuses: [
    { id: 'done', name: 'Concluído', category: 'done', position: 2 },
    { id: 'todo', name: 'A fazer', category: 'todo', position: 0 },
    { id: 'doing', name: 'Em andamento', category: 'in_progress', position: 1 },
  ],
  transitions: [
    { fromStatusId: 'todo', toStatusId: 'doing' },
    { fromStatusId: 'doing', toStatusId: 'todo' },
    { fromStatusId: 'doing', toStatusId: 'done' },
    { fromStatusId: 'done', toStatusId: 'doing' },
  ],
};

describe('workflow (BR-004)', () => {
  it('starts tasks in the first todo status by position', () => {
    expect(initialStatus(workflow)?.id).toBe('todo');
    expect(initialStatus({ statuses: [], transitions: [] })).toBeNull();
  });

  it('BR-004: allows only the configured transitions', () => {
    expect(transitionTargets(workflow, 'doing')).toEqual(['todo', 'done']);
    assertTransitionAllowed(workflow, 'todo', 'doing');
    expect(() => assertTransitionAllowed(workflow, 'todo', 'done')).toThrow(
      TransitionNotAllowedError,
    );
    expect(() => assertTransitionAllowed(workflow, 'todo', 'todo')).toThrow(
      TransitionNotAllowedError,
    );
  });
});
