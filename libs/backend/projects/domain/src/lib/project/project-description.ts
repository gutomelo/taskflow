import { normalizeDisplayText } from '@taskflow/backend/shared/kernel';
import { InvalidProjectDescriptionError } from '../errors';

export const PROJECT_DESCRIPTION_MAX_LENGTH = 2000;

/**
 * Descrição em várias linhas. Cada linha passa pela mesma normalização de texto exibível
 * (`normalizeDisplayText` juntaria as quebras); linhas em branco das bordas são removidas.
 * Vazia ⇒ `null` (sem descrição).
 */
export function parseProjectDescription(raw: string | null): string | null {
  if (raw === null) return null;
  const lines: string[] = [];
  for (const line of raw.split(/\r\n|\r|\n/u)) {
    const normalized = normalizeDisplayText(line, {
      minLength: 0,
      maxLength: PROJECT_DESCRIPTION_MAX_LENGTH,
    });
    if (normalized === null) throw new InvalidProjectDescriptionError();
    lines.push(normalized);
  }
  while (lines[0] === '') lines.shift();
  while (lines.at(-1) === '') lines.pop();
  const description = lines.join('\n');
  if ([...description].length > PROJECT_DESCRIPTION_MAX_LENGTH) {
    throw new InvalidProjectDescriptionError();
  }
  return description === '' ? null : description;
}
