import { DomainError } from '@taskflow/backend/shared/kernel';
import * as application from '@taskflow/backend/tasks/application';
import * as domain from '@taskflow/backend/tasks/domain';
import { parseTaskKey, PRIORITIES } from '@taskflow/backend/tasks/domain';
import { TASK_KEY_PATTERN, taskPrioritySchema } from '@taskflow/contracts';
import { tasksErrorMappings } from './tasks-error-mappings';

/** Todas as classes de erro exportadas pelo domínio e pela aplicação de `tasks`. */
function exportedErrorCodes(): string[] {
  const codes: string[] = [];
  for (const exported of [...Object.values(domain), ...Object.values(application)]) {
    if (typeof exported !== 'function' || !(exported.prototype instanceof DomainError)) continue;
    // Construtores sem argumentos obrigatórios; os que recebem ids aceitam lista vazia.
    const instance: unknown = Reflect.construct(exported, [[]]);
    if (instance instanceof DomainError) codes.push(instance.code);
  }
  return codes.sort();
}

// O domínio não importa `libs/contracts`: os catálogos são espelhados e esta é a camada que
// enxerga os dois. Divergência quebra aqui, não em produção.
describe('tasks catalog parity (domain × contracts × HTTP)', () => {
  it('keeps the priorities identical', () => {
    expect([...taskPrioritySchema.options]).toEqual([...PRIORITIES]);
  });

  it('keeps the task key format identical (BR-028)', () => {
    for (const key of [
      'WEB-1',
      'AB-999999999',
      'WEB-0',
      'WEB-01',
      'web-1',
      'W-1',
      'WEB-1234567890',
    ]) {
      expect(TASK_KEY_PATTERN.test(key), key).toBe(parseTaskKey(key) !== null);
    }
  });

  it('maps every error code of the context to an explicit HTTP status', () => {
    const codes = exportedErrorCodes();

    expect(codes.length).toBeGreaterThanOrEqual(20);
    expect(codes.filter((code) => !(code in tasksErrorMappings))).toEqual([]);
  });
});
