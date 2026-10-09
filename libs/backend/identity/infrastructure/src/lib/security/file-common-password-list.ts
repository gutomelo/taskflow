import { readFile } from 'node:fs/promises';
import type { CommonPasswordList } from '@taskflow/backend/identity/domain';

/**
 * Lista local de senhas comuns/vazadas (BR-011), carregada uma vez em memória (~100 mil
 * entradas, poucos MB). Origem e licença em `assets/common-passwords.NOTICE.md`.
 */
export class FileCommonPasswordList implements CommonPasswordList {
  private constructor(private readonly entries: ReadonlySet<string>) {}

  /** Arquivo já normalizado (NFC, minúsculas): uma senha por linha. */
  static async load(filePath: string): Promise<FileCommonPasswordList> {
    const content = await readFile(filePath, 'utf8');
    const entries = new Set(content.split('\n').filter((line) => line.length > 0));
    if (entries.size === 0) {
      throw new Error(`Common password list at ${filePath} is empty`);
    }
    return new FileCommonPasswordList(entries);
  }

  get size(): number {
    return this.entries.size;
  }

  contains(password: string): boolean {
    return this.entries.has(password.normalize('NFC').toLowerCase());
  }
}
