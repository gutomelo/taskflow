/** Fonte de tempo injetável: domínio e aplicação nunca chamam `new Date()` diretamente. */
export interface Clock {
  now(): Date;
}
