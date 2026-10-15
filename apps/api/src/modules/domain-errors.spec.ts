import { identityErrorMappings } from '@taskflow/backend/identity/http';
import { organizationsErrorMappings } from '@taskflow/backend/organizations/http';
import { projectsErrorMappings } from '@taskflow/backend/projects/http';
import { tasksErrorMappings } from '@taskflow/backend/tasks/http';
import { mergeDomainErrors } from './domain-errors';

describe('mergeDomainErrors (spec 003, S-7)', () => {
  it('accepts the codes the contexts share on purpose, with the same status and title', () => {
    const merged = mergeDomainErrors(
      identityErrorMappings,
      organizationsErrorMappings,
      projectsErrorMappings,
      tasksErrorMappings,
    );

    expect(merged['MEMBER_NOT_FOUND']).toEqual(organizationsErrorMappings['MEMBER_NOT_FOUND']);
    expect(merged['PROJECT_NOT_FOUND']).toEqual({ status: 404, title: 'Projeto não encontrado' });
    expect(merged['TASK_HAS_PENDING_REQUIRED_SUBTASKS']?.status).toBe(422);
  });

  it('refuses a shared code mapped differently by two contexts', () => {
    expect(() =>
      mergeDomainErrors(
        { MEMBER_NOT_FOUND: { status: 404, title: 'Membro não encontrado' } },
        { MEMBER_NOT_FOUND: { status: 422, title: 'Outro' } },
      ),
    ).toThrow('Conflicting HTTP mappings for domain error MEMBER_NOT_FOUND');
  });
});
