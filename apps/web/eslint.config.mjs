import nx from '@nx/eslint-plugin';
import baseConfig from '../../eslint.config.mjs';

export default [
  ...nx.configs['flat/angular'],
  ...nx.configs['flat/angular-template'],
  ...baseConfig,
  {
    files: ['**/*.ts'],
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        {
          type: 'attribute',
          prefix: 'tf',
          style: 'camelCase',
        },
      ],
      '@angular-eslint/component-selector': [
        'error',
        {
          type: 'element',
          prefix: 'tf',
          style: 'kebab-case',
        },
      ],
    },
  },
  {
    files: ['**/*.ts'],
    ignores: ['**/*.spec.ts'],
    rules: {
      // Os schemas Zod de @taskflow/contracts pesariam ~500 kB no bundle inicial (T25):
      // no frontend os contratos entram só como tipos; formas são verificadas em core/http.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@taskflow/contracts',
              allowTypeImports: true,
              message: 'Use `import type`; valide respostas com core/http/contract-guards.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.html'],
    // Override or add rules here
    rules: {},
  },
];
