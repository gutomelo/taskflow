import { InvalidProjectKeyError } from '../errors';

const PROJECT_KEY = /^[A-Z][A-Z0-9]{1,9}$/;

/**
 * BR-025: identifica o projeto na organização (e, na spec 004, as tarefas: `WEB-42`). Única na
 * organização, imutável. Minúsculas são recusadas, não convertidas: a interface converte ao
 * digitar e a API não muda silenciosamente o que recebeu.
 */
export class ProjectKey {
  private constructor(readonly value: string) {}

  static create(raw: string): ProjectKey {
    if (!PROJECT_KEY.test(raw)) throw new InvalidProjectKeyError();
    return new ProjectKey(raw);
  }

  static isValid(raw: string): boolean {
    return PROJECT_KEY.test(raw);
  }

  toString(): string {
    return this.value;
  }
}
