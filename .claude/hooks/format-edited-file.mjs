#!/usr/bin/env node
// PostToolUse (Edit|Write): formata com Prettier o arquivo recém-editado.
// Silencioso e não bloqueante: falhas (ex.: sintaxe incompleta no meio de uma edição) são ignoradas;
// o lint/format:check do CI continua sendo o gate.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';

const FORMATTABLE_EXTENSIONS = new Set([
  '.ts',
  '.mts',
  '.cts',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.html',
  '.css',
  '.scss',
  '.md',
  '.yml',
  '.yaml',
]);

let rawInput = '';
for await (const chunk of process.stdin) rawInput += chunk;

try {
  const filePath = JSON.parse(rawInput).tool_input?.file_path;
  const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const prettierBin = join(projectDir, 'node_modules', '.bin', 'prettier');

  if (
    typeof filePath === 'string' &&
    filePath.startsWith(projectDir) &&
    FORMATTABLE_EXTENSIONS.has(extname(filePath)) &&
    existsSync(filePath) &&
    existsSync(prettierBin)
  ) {
    execFileSync(prettierBin, ['--write', '--ignore-unknown', '--log-level=silent', filePath], {
      cwd: projectDir,
      stdio: 'ignore',
      timeout: 15_000,
    });
  }
} catch {
  // Intencionalmente ignorado: formatação é conveniência, não verificação.
}
process.exit(0);
