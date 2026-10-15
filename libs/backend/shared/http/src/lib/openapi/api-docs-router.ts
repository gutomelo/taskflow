import express, { Router } from 'express';
import { getAbsoluteFSPath } from 'swagger-ui-dist';

const DOCS_PAGE = `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <title>TaskFlow API — documentação</title>
    <link rel="stylesheet" href="assets/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="assets/swagger-ui-bundle.js"></script>
    <script src="swagger-initializer.js"></script>
  </body>
</html>`;

// Arquivo separado (sem script inline): compatível com a CSP padrão do Helmet.
const INITIALIZER = `window.ui = SwaggerUIBundle({
  url: 'openapi.json',
  dom_id: '#swagger-ui',
  withCredentials: true,
  deepLinking: true,
});`;

/**
 * Documentação da API: `GET /docs/` (Swagger UI) e `GET /docs/openapi.json`.
 * Montado apenas fora de produção pelo composition root (spec 001, RF-14).
 */
export function createApiDocsRouter(document: object): Router {
  // strict: `/docs` e `/docs/` são rotas distintas (assets usam caminhos relativos à barra final).
  const router = Router({ strict: true });
  const json = JSON.stringify(document);

  router.get('/docs', (_request, response) => response.redirect(301, 'docs/'));
  router.get('/docs/', (_request, response) => response.type('html').send(DOCS_PAGE));
  router.get('/docs/openapi.json', (_request, response) => response.type('json').send(json));
  router.get('/docs/swagger-initializer.js', (_request, response) =>
    response.type('application/javascript').send(INITIALIZER),
  );
  router.use('/docs/assets', express.static(getAbsoluteFSPath(), { index: false, maxAge: '1h' }));
  return router;
}
