#!/usr/bin/env node
// PreToolUse (Edit|Write|NotebookEdit): impede edição manual de arquivos sensíveis ou gerados.
// Saída 2 bloqueia a ferramenta e devolve o motivo (stderr) ao Claude.
import { relative, sep } from 'node:path';

const PROTECTED_RULES = [
  {
    test: (path) => /(^|\/)\.env(\..+)?$/.test(path) && !path.endsWith('.env.example'),
    reason:
      'Arquivos .env contêm segredos locais e não devem ser editados pelo agente. Altere .env.example e peça ao usuário para ajustar o .env.',
  },
  {
    test: (path) => path === 'pnpm-lock.yaml',
    reason: 'pnpm-lock.yaml só pode mudar via pnpm add/remove/update.',
  },
  {
    test: (path) => path.includes('/generated/prisma/'),
    reason:
      'O Prisma Client é gerado. Altere os modelos em prisma/models/ e rode pnpm db:generate.',
  },
  {
    test: (path) =>
      path.startsWith('node_modules/') || path.startsWith('dist/') || path.startsWith('.nx/'),
    reason: 'Diretórios de dependências, build e cache não devem ser editados.',
  },
];

let rawInput = '';
for await (const chunk of process.stdin) rawInput += chunk;

let filePath;
try {
  const input = JSON.parse(rawInput);
  filePath = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
} catch {
  process.exit(0); // Entrada inesperada: não bloquear o fluxo normal de permissões.
}
if (typeof filePath !== 'string') process.exit(0);

const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const relativePath = relative(projectDir, filePath).split(sep).join('/');
if (relativePath.startsWith('..')) process.exit(0);

const violatedRule = PROTECTED_RULES.find((rule) => rule.test(relativePath));
if (violatedRule) {
  process.stderr.write(`Bloqueado (${relativePath}): ${violatedRule.reason}\n`);
  process.exit(2);
}
process.exit(0);
