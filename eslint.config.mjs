import nx from '@nx/eslint-plugin';

// Restrições de dependência entre projetos. Fonte de verdade documentada em
// docs/architecture/dependency-rules.md — ao alterar aqui, atualize o documento.

const BOUNDED_CONTEXTS = [
  'identity',
  'organizations',
  'projects',
  'tasks',
  'boards',
  'sprints',
  'collaboration',
  'notifications',
  'analytics',
  'audit',
];

// Domain e application não conhecem detalhes técnicos.
const INFRASTRUCTURE_PACKAGES = [
  'express',
  '@prisma/*',
  'prisma',
  'ioredis',
  'bullmq',
  'socket.io',
  'pino',
  'pino-http',
  '@angular/*',
];

const contextConstraints = BOUNDED_CONTEXTS.map((context) => ({
  sourceTag: `domain:${context}`,
  onlyDependOnLibsWithTags: [`domain:${context}`, 'domain:shared'],
}));

/**
 * ADR 0012 / spec 006: seletores que barram a leitura de `params.organizationId` fora de
 * `tenant-context.ts`. Constante porque todo bloco que declara `no-restricted-syntax` substitui os
 * anteriores e precisa repeti-los.
 */
const TENANT_PARAM_RESTRICTIONS = [
  {
    selector: "MemberExpression[object.property.name='params'][property.name='organizationId']",
    message:
      'Use tenantRequestContextFrom(request): params.organizationId só é lido em tenant-context.ts.',
  },
  {
    selector: "MemberExpression[object.property.name='params'][property.value='organizationId']",
    message:
      'Use tenantRequestContextFrom(request): params.organizationId só é lido em tenant-context.ts.',
  },
  {
    // Apelido (`const { params } = request; params.organizationId`) e template literal.
    selector:
      "MemberExpression[object.name='params'][property.name='organizationId'], MemberExpression[object.property.name='params'] > TemplateLiteral.property > TemplateElement[value.raw='organizationId']",
    message:
      'Use tenantRequestContextFrom(request): params.organizationId só é lido em tenant-context.ts.',
  },
  {
    // Desestruturação: `const { organizationId } = request.params` e `({ params: { organizationId } })`.
    selector:
      "VariableDeclarator[init.property.name='params'] > ObjectPattern > Property[key.name='organizationId'], Property[key.name='params'] > ObjectPattern > Property[key.name='organizationId']",
    message:
      'Use tenantRequestContextFrom(request): params.organizationId só é lido em tenant-context.ts.',
  },
];

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: ['**/dist', '**/out-tsc', '**/vitest.config.*.timestamp*', '**/generated/prisma/**'],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
          depConstraints: [
            // Runtime
            {
              sourceTag: 'scope:frontend',
              onlyDependOnLibsWithTags: ['scope:frontend', 'scope:shared'],
            },
            {
              sourceTag: 'scope:backend',
              onlyDependOnLibsWithTags: ['scope:backend', 'scope:shared'],
            },
            { sourceTag: 'scope:shared', onlyDependOnLibsWithTags: ['scope:shared'] },

            // Bounded contexts: nenhum contexto importa outro.
            { sourceTag: 'domain:shared', onlyDependOnLibsWithTags: ['domain:shared'] },
            ...contextConstraints,

            // Camadas do backend
            {
              sourceTag: 'type:domain',
              onlyDependOnLibsWithTags: ['type:domain'],
              // Domínio é TypeScript puro: nenhum pacote externo (ex.: argon2 entra via porta).
              allowedExternalImports: [],
            },
            {
              sourceTag: 'type:application',
              onlyDependOnLibsWithTags: ['type:domain', 'type:application'],
              bannedExternalImports: INFRASTRUCTURE_PACKAGES,
            },
            {
              sourceTag: 'type:infrastructure',
              onlyDependOnLibsWithTags: ['type:domain', 'type:application', 'type:infrastructure'],
              bannedExternalImports: ['express', '@angular/*'],
            },
            {
              sourceTag: 'type:presentation',
              onlyDependOnLibsWithTags: [
                'type:application',
                'type:domain',
                'type:contracts',
                'type:presentation',
              ],
              // Middlewares recebem portas; nunca falam com Redis ou filas diretamente.
              bannedExternalImports: ['@prisma/*', 'prisma', 'ioredis', 'bullmq', '@angular/*'],
            },
            {
              sourceTag: 'type:contracts',
              onlyDependOnLibsWithTags: ['type:contracts'],
              // Contratos atravessam backend e frontend: apenas schemas Zod.
              allowedExternalImports: ['zod'],
            },

            // Camadas do frontend
            {
              sourceTag: 'type:feature',
              onlyDependOnLibsWithTags: [
                'type:feature',
                'type:ui',
                'type:data-access',
                'type:util',
                'type:model',
                'type:contracts',
              ],
            },
            {
              sourceTag: 'type:ui',
              onlyDependOnLibsWithTags: ['type:ui', 'type:util', 'type:model'],
            },
            {
              sourceTag: 'type:data-access',
              onlyDependOnLibsWithTags: [
                'type:data-access',
                'type:util',
                'type:model',
                'type:contracts',
              ],
            },
            { sourceTag: 'type:util', onlyDependOnLibsWithTags: ['type:util'] },
            { sourceTag: 'type:model', onlyDependOnLibsWithTags: ['type:model', 'type:contracts'] },

            // Apps e E2E
            { sourceTag: 'type:app', onlyDependOnLibsWithTags: ['*'] },
            { sourceTag: 'type:e2e', onlyDependOnLibsWithTags: ['type:contracts'] },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.cts', '**/*.mts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': 'error',
    },
  },
  {
    // ADR 0012 / spec 006: o tenant vem só do middleware. Com `mergeParams`, um parâmetro filho
    // chamado `organizationId` teria precedência sobre o do prefixo — ninguém mais o lê.
    files: ['**/*.ts'],
    // Padrão com `**/`: os `eslint.config.mjs` dos projetos reexportam este arquivo e os caminhos
    // passam a ser relativos ao projeto, então um caminho exato a partir da raiz não casaria.
    ignores: ['**/tenant/tenant-context.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...TENANT_PARAM_RESTRICTIONS],
    },
  },
];

/**
 * ADR 0015: `Membership.projectParticipations` existe só porque o Prisma exige a relação nos dois
 * modelos para a FK de `project_members`. O código de `organizations` não pode usá-la nem tocar as
 * tabelas de `projects`. Incluída pelos `eslint.config.mjs` das bibliotecas de `organizations`
 * (aqui um `files` com caminho da raiz não casaria: os caminhos ficam relativos a cada projeto).
 */
export const organizationsMustNotReachProjects = {
  files: ['**/*.ts'],
  rules: {
    // Repete as restrições do tenant: este bloco substitui o `no-restricted-syntax` anterior.
    'no-restricted-syntax': [
      'error',
      ...TENANT_PARAM_RESTRICTIONS,
      {
        selector:
          'MemberExpression[property.name=/^(projects|projectParticipations|project|projectMember|workflowStatus|workflowTransition)$/], Property[key.name=/^(projects|projectParticipations)$/]',
        message:
          'ADR 0015: organizations não usa a back-relation nem os modelos de projects; integre por porta.',
      },
    ],
  },
};
