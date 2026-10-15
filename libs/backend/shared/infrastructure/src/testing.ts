// Utilitários exclusivos para testes de integração (importados como
// `@taskflow/backend/shared/infrastructure/testing`). Nunca usar em código de produção.
export {
  startPostgresTestDatabase,
  type PostgresTestDatabase,
} from './testing/postgres-test-database';
