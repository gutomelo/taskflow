// Textos de interface centralizados (pt-BR) para facilitar a futura internacionalização.
export const systemStatusMessages = {
  title: 'Status do sistema',
  subtitle: 'Verificação da API e das dependências de infraestrutura.',
  loading: 'Verificando serviços…',
  ready: 'Todos os serviços estão operacionais.',
  degraded: 'Alguns serviços estão indisponíveis. Funcionalidades podem falhar.',
  unavailable: 'Não foi possível contatar a API. Verifique se ela está em execução.',
  retry: 'Tentar novamente',
  up: 'Operacional',
  down: 'Indisponível',
  latency: (milliseconds: number) => `${milliseconds} ms`,
  dependencyLabels: {
    postgres: 'Banco de dados (PostgreSQL)',
    redis: 'Cache e filas (Redis)',
  } as Readonly<Record<string, string>>,
} as const;
