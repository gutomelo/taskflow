import * as application from '@taskflow/backend/collaboration/application';
import * as domain from '@taskflow/backend/collaboration/domain';
import { MENTION_TOKEN } from '@taskflow/backend/collaboration/domain';
import { DomainError } from '@taskflow/backend/shared/kernel';
import { MENTION_TOKEN_PATTERN } from '@taskflow/contracts';
import { collaborationErrorMappings } from './collaboration-error-mappings';

/** Todas as classes de erro exportadas pelo domínio e pela aplicação de `collaboration`. */
function exportedErrorCodes(): string[] {
  const codes: string[] = [];
  for (const exported of [...Object.values(domain), ...Object.values(application)]) {
    if (typeof exported !== 'function' || !(exported.prototype instanceof DomainError)) continue;
    const instance: unknown = Reflect.construct(exported, []);
    if (instance instanceof DomainError) codes.push(instance.code);
  }
  return codes.sort();
}

// O domínio não importa `libs/contracts`: a gramática do token é espelhada e esta é a camada que
// enxerga os dois (B2 da segurança: backend e frontend reconhecem as mesmas menções).
describe('collaboration catalog parity (domain × contracts × HTTP)', () => {
  it('keeps the mention token grammar identical', () => {
    expect(MENTION_TOKEN_PATTERN.source).toBe(MENTION_TOKEN.source);
    expect(MENTION_TOKEN_PATTERN.flags).toBe(MENTION_TOKEN.flags);
  });

  it('maps every error code of the context to an explicit HTTP status', () => {
    const codes = exportedErrorCodes();

    expect(codes.length).toBeGreaterThanOrEqual(12);
    expect(codes.filter((code) => !(code in collaborationErrorMappings))).toEqual([]);
  });
});
