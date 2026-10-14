import {
  InvalidStatusNameError,
  InvalidStatusOrderError,
  InvalidStatusTargetError,
  InvalidTransitionError,
  StatusInUseError,
  StatusLimitReachedError,
  StatusNameTakenError,
  StatusNotFoundError,
  WorkflowNeedsTodoStatusError,
} from '../errors';
import { defaultWorkflow, type Workflow } from './workflow';
import {
  addStatus,
  changeCategory,
  MAX_WORKFLOW_STATUSES,
  removeStatus,
  renameStatus,
  reorderStatuses,
  replaceTransitions,
} from './workflow-editing';

function base() {
  let next = 0;
  const workflow = defaultWorkflow(() => `s${(next += 1)}`); // s1 A fazer, s2 Em andamento, s3 Concluído
  return workflow;
}
const names = (workflow: Workflow) =>
  [...workflow.statuses].sort((a, b) => a.position - b.position).map((status) => status.name);
const NO_USAGE = new Map<string, number>();

describe('editable workflow (BR-030, spec 005)', () => {
  it('BR-030: adds a status at the end, without transitions, with a normalized name', () => {
    const workflow = addStatus(base(), {
      id: 's4',
      name: '  Em   revisão ',
      category: 'in_progress',
    });

    expect(names(workflow)).toEqual(['A fazer', 'Em andamento', 'Concluído', 'Em revisão']);
    expect(workflow.statuses.map((status) => status.position).sort()).toEqual([0, 1, 2, 3]);
    expect(workflow.transitions).toEqual(base().transitions);
  });

  it('BR-030: names are 1–40 displayable characters, unique without case', () => {
    expect(() => addStatus(base(), { id: 's4', name: '', category: 'todo' })).toThrow(
      InvalidStatusNameError,
    );
    expect(() => addStatus(base(), { id: 's4', name: 'x'.repeat(41), category: 'todo' })).toThrow(
      InvalidStatusNameError,
    );
    expect(() => addStatus(base(), { id: 's4', name: 'Rev‮isão', category: 'todo' })).toThrow(
      InvalidStatusNameError,
    );
    expect(() => addStatus(base(), { id: 's4', name: 'a FAZER', category: 'todo' })).toThrow(
      StatusNameTakenError,
    );
    expect(() => renameStatus(base(), 's2', 'concluído')).toThrow(StatusNameTakenError);
    expect(names(renameStatus(base(), 's2', 'EM ANDAMENTO'))).toContain('EM ANDAMENTO');
  });

  it('BR-030: at most 20 statuses', () => {
    let workflow = base();
    for (let index = workflow.statuses.length; index < MAX_WORKFLOW_STATUSES; index += 1) {
      workflow = addStatus(workflow, {
        id: `x${index}`,
        name: `Etapa ${index}`,
        category: 'in_progress',
      });
    }
    expect(() => addStatus(workflow, { id: 'y', name: 'Demais', category: 'todo' })).toThrow(
      StatusLimitReachedError,
    );
  });

  it('BR-030: category changes only on a status without any task, and a todo always remains', () => {
    expect(() => changeCategory(base(), 's2', 'done', new Map([['s2', 1]]))).toThrow(
      StatusInUseError,
    );
    expect(
      changeCategory(base(), 's2', 'done', NO_USAGE).statuses.find((s) => s.id === 's2')?.category,
    ).toBe('done');
    expect(() => changeCategory(base(), 's1', 'in_progress', NO_USAGE)).toThrow(
      WorkflowNeedsTodoStatusError,
    );
    expect(changeCategory(base(), 's2', 'in_progress', new Map([['s2', 9]]))).toEqual(base());
  });

  it('BR-030: reorders with exactly the statuses of the workflow; unknown ids are 404 first', () => {
    expect(names(reorderStatuses(base(), ['s3', 's1', 's2']))).toEqual([
      'Concluído',
      'A fazer',
      'Em andamento',
    ]);
    expect(() => reorderStatuses(base(), ['s3', 's1'])).toThrow(InvalidStatusOrderError);
    expect(() => reorderStatuses(base(), ['s3', 's1', 's1'])).toThrow(InvalidStatusOrderError);
    expect(() => reorderStatuses(base(), ['s3', 's1', 'foreign'])).toThrow(StatusNotFoundError);
    expect(() => reorderStatuses(base(), ['s3', 's1', 's2', 'foreign'])).toThrow(
      StatusNotFoundError,
    );
  });

  describe('removal (RF-08, D2)', () => {
    const withReview = () =>
      addStatus(base(), { id: 's4', name: 'Em revisão', category: 'in_progress' });

    it('an empty status goes without target; its transitions go with it', () => {
      const workflow = replaceTransitions(withReview(), [
        { fromStatusId: 's2', toStatusId: 's4' },
        { fromStatusId: 's4', toStatusId: 's3' },
      ]);
      const result = removeStatus(workflow, 's4', null, NO_USAGE);

      expect(names(result.workflow)).toEqual(['A fazer', 'Em andamento', 'Concluído']);
      expect(result.workflow.transitions).toEqual([]);
      expect(result.targetStatusId).toBeNull();
    });

    it('with tasks, needs a different target of the same category', () => {
      const usage = new Map([['s4', 3]]);

      expect(removeStatus(withReview(), 's4', 's2', usage).targetStatusId).toBe('s2');
      expect(() => removeStatus(withReview(), 's4', null, usage)).toThrow(InvalidStatusTargetError);
      expect(() => removeStatus(withReview(), 's4', 's4', usage)).toThrow(InvalidStatusTargetError);
      expect(() => removeStatus(withReview(), 's4', 's3', usage)).toThrow(InvalidStatusTargetError);
      expect(() => removeStatus(withReview(), 's4', 'foreign', usage)).toThrow(StatusNotFoundError);
      expect(() => removeStatus(withReview(), 'foreign', 's2', usage)).toThrow(StatusNotFoundError);
    });

    it('the only status of a category with tasks cannot go; the only todo never goes', () => {
      expect(() => removeStatus(base(), 's3', null, new Map([['s3', 1]]))).toThrow(
        InvalidStatusTargetError,
      );
      expect(() => removeStatus(base(), 's1', null, NO_USAGE)).toThrow(
        WorkflowNeedsTodoStatusError,
      );
      expect(removeStatus(base(), 's3', null, NO_USAGE).workflow.statuses).toHaveLength(2);
    });
  });

  it('BR-030: transitions link distinct statuses of the workflow, without repetition', () => {
    const transitions = [
      { fromStatusId: 's1', toStatusId: 's3' },
      { fromStatusId: 's3', toStatusId: 's1' },
    ];

    expect(replaceTransitions(base(), transitions).transitions).toEqual(transitions);
    expect(replaceTransitions(base(), []).transitions).toEqual([]);
    expect(() => replaceTransitions(base(), [{ fromStatusId: 's1', toStatusId: 's1' }])).toThrow(
      InvalidTransitionError,
    );
    expect(() =>
      replaceTransitions(base(), [...transitions, { fromStatusId: 's1', toStatusId: 's3' }]),
    ).toThrow(InvalidTransitionError);
    expect(() =>
      replaceTransitions(base(), [{ fromStatusId: 's1', toStatusId: 'foreign' }]),
    ).toThrow(StatusNotFoundError);
  });
});
