/**
 * Identificação aproximada do navegador e sistema para a lista de sessões (RF-08). Heurística
 * simples sobre o user agent — suficiente para o usuário reconhecer seus dispositivos; o
 * frontend formata o texto (i18n). `null` quando não reconhecido.
 */
export type DeviceSummary = Readonly<{ browser: string | null; os: string | null }>;

const BROWSERS: ReadonlyArray<[RegExp, string]> = [
  [/Edg\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/Firefox\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];

const OPERATING_SYSTEMS: ReadonlyArray<[RegExp, string]> = [
  [/Android/, 'Android'],
  [/iPhone|iPad|iOS/, 'iOS'],
  [/Windows/, 'Windows'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/CrOS/, 'ChromeOS'],
  [/Linux/, 'Linux'],
];

const firstMatch = (value: string, patterns: ReadonlyArray<[RegExp, string]>) =>
  patterns.find(([pattern]) => pattern.test(value))?.[1] ?? null;

export function summarizeUserAgent(userAgent: string | null): DeviceSummary {
  if (!userAgent) return { browser: null, os: null };
  return { browser: firstMatch(userAgent, BROWSERS), os: firstMatch(userAgent, OPERATING_SYSTEMS) };
}
