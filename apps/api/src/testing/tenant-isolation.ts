import type { Router } from 'express';
import { noStore, TENANT_PATH_PREFIX } from '@taskflow/backend/shared/http';

// Harness de isolamento (spec 006, RF-08). Toda leitura dos internos do router do Express 5
// (`router.stack`, `layer.slash`, `layer.match`) fica neste arquivo e falha fechada: uma estrutura
// não reconhecida derruba o teste em vez de esconder rotas.

/** `MÉTODO caminho`, com o caminho completo sob `/api/v1` (ex.: `GET /organizations/:organizationId/members`). */
export type RouteKey = string;

const PREFIX_SAMPLE = '/organizations/00000000-0000-7000-8000-000000000000/sample';
/**
 * Middlewares sem rota permitidos dentro dos routers de contexto (não respondem sozinhos),
 * reconhecidos pela **identidade** da função: outro handler com o mesmo nome não passa.
 */
const CONTEXT_MIDDLEWARES: ReadonlySet<unknown> = new Set([noStore]);

type Layer = Router['stack'][number];

function subRouterOf(layer: Layer): ReadonlyArray<Layer> | null {
  const handle: unknown = layer.handle;
  if (typeof handle !== 'function' || !('stack' in handle) || !Array.isArray(handle.stack))
    return null;
  const stack: Layer[] = handle.stack;
  return stack;
}

const isSlash = (layer: Layer) => 'slash' in layer && layer.slash === true;

function matches(layer: Layer, path: string): boolean {
  if (!('match' in layer) || typeof layer.match !== 'function') return false;
  return Reflect.apply(layer.match, layer, [path]) === true;
}

function routeKeys(layer: Layer, base: string): RouteKey[] {
  const route = layer.route;
  if (!route) return [];
  const path = `${base}${route.path === '/' ? '' : route.path}` || '/';
  const methods = new Set(route.stack.map((handler) => (handler.method ?? '_all').toUpperCase()));
  return [...methods].map((method) => `${method} ${path}`);
}

function walk(
  stack: ReadonlyArray<Layer>,
  base: string,
  where: string,
  middlewareAllowed: (layer: Layer) => boolean,
): RouteKey[] {
  return stack.flatMap((layer) => {
    if (layer.route) return routeKeys(layer, base);
    const child = subRouterOf(layer);
    if (child) {
      // Sub-router montado com caminho próprio: o caminho não é recuperável ⇒ falha fechado.
      if (!isSlash(layer))
        throw new Error(`${where}: sub-router mounted with its own path (${layer.name})`);
      return walk(child, base, where, middlewareAllowed);
    }
    if (!middlewareAllowed(layer)) {
      throw new Error(`${where}: route-less layer "${layer.name}" is not an allowed middleware`);
    }
    return [];
  });
}

/** Rotas do escopo do tenant, com caminho completo. */
export function listTenantRoutes(tenantScope: Router): RouteKey[] {
  const [prefix, ...others] = tenantScope.stack;
  if (!prefix || others.length > 0 || isSlash(prefix) || !matches(prefix, PREFIX_SAMPLE)) {
    throw new Error('tenant scope: expected exactly one layer mounted on the tenant prefix');
  }
  const scoped = subRouterOf(prefix);
  if (!scoped) throw new Error('tenant scope: prefix layer is not a router');
  // No nível do escopo ficam os guardas (authenticate, csrf, tenantContext) e os routers de contexto.
  return scoped.flatMap((layer) => {
    if (layer.route) throw new Error('tenant scope: routes must live in context routers');
    const child = subRouterOf(layer);
    // Guardas do escopo valem para todo o prefixo; um middleware com caminho próprio seria um
    // handler escondido da varredura.
    if (!child && !isSlash(layer))
      throw new Error(`tenant scope: middleware "${layer.name}" mounted with its own path`);
    if (!child) return [];
    if (!isSlash(layer)) throw new Error('tenant scope: context router mounted with its own path');
    return walk(child, TENANT_PATH_PREFIX, 'tenant context router', (inner) =>
      CONTEXT_MIDDLEWARES.has(inner.handle),
    );
  });
}

/**
 * Rotas dos routers globais (sem organização ativa). Sub-routers e middlewares com caminho próprio
 * são recusados: um `router.use('/organizations/:organizationId/x', handler)` escaparia da lista.
 */
export function listGlobalRoutes(routers: ReadonlyArray<Router>): RouteKey[] {
  return routers.flatMap((router) => walk(router.stack, '', 'global router', isSlash));
}

/** Parâmetros de caminho de uma rota, exceto o do tenant (ex.: `['userId']`). */
export function pathParams(route: RouteKey): string[] {
  return [...route.matchAll(/:([A-Za-z]+)/g)]
    .map((match) => match[1] ?? '')
    .filter((name) => name !== '' && name !== 'organizationId');
}

/** Monta o caminho concreto trocando cada `:param` pelo valor dado. */
export function concretePath(route: RouteKey, values: Readonly<Record<string, string>>): string {
  const [, path = ''] = route.split(' ');
  return path.replace(/:([A-Za-z]+)/g, (_match, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error(`no value for :${name} in ${route}`);
    return value;
  });
}

export const methodOf = (route: RouteKey) => (route.split(' ')[0] ?? '').toLowerCase();

/**
 * Variante de isolamento de uma referência da rota: `not-found` = id real de B sob o prefixo de A
 * deve dar 404; `no-leak` = a resposta (lista) não pode conter ids de B.
 */
export type IsolationExpectation = 'not-found' | 'no-leak';

/** Schema de entrada declarado num caso (Zod `object`): só as chaves importam aqui. */
export type InputSchema = Readonly<{ shape: Readonly<Record<string, unknown>> }>;

/**
 * Referências de entrada que precisam de variante (spec 003, obrigação 6 da spec 006): campos que
 * apontam para outro recurso (`…Id`) e o cursor de paginação (`no-leak`).
 */
export function inputReferences(schema: InputSchema | null): string[] {
  return schema
    ? Object.keys(schema.shape).filter((key) => key.endsWith('Id') || key === 'cursor')
    : [];
}

/** Caso de isolamento como o harness o enxerga (corpo e query declarados, `null` = nenhum). */
export type DeclaredCase = Readonly<{
  body: InputSchema | null;
  query: InputSchema | null;
  references: Readonly<Record<string, unknown>>;
}>;

const BODY_METHODS = new Set(['post', 'put', 'patch']);

/**
 * Cobertura: cada rota do tenant tem caso; cada parâmetro de caminho e cada referência de corpo
 * ou query (derivada do schema declarado) tem variante; rota que recebe corpo declara o schema.
 */
export function coverageGaps(
  routes: ReadonlyArray<RouteKey>,
  cases: Readonly<Record<RouteKey, DeclaredCase>>,
): string[] {
  const gaps: string[] = [];
  for (const route of routes) {
    const declared = cases[route];
    if (!declared) {
      gaps.push(`${route}: no isolation case`);
      continue;
    }
    for (const param of pathParams(route)) {
      if (!Object.hasOwn(declared.references, param))
        gaps.push(`${route}: no variant for :${param}`);
    }
    if (BODY_METHODS.has(methodOf(route)) && !declared.body) {
      // POST sem corpo (ex.: reenviar convite) declara um schema vazio, nunca omite.
      gaps.push(`${route}: no body schema declared`);
    }
    for (const [where, schema] of [
      ['body', declared.body],
      ['query', declared.query],
    ] as const) {
      for (const field of inputReferences(schema)) {
        if (!Object.hasOwn(declared.references, field))
          gaps.push(`${route}: no variant for ${where}.${field}`);
      }
    }
  }
  for (const route of Object.keys(cases)) {
    if (!routes.includes(route)) gaps.push(`${route}: case for a route that is not mounted`);
  }
  return gaps;
}

/** Rotas globais fora da allowlist ou que carregam o tenant no caminho (deveriam estar no escopo). */
export function globalViolations(
  routes: ReadonlyArray<RouteKey>,
  allowlist: Readonly<Record<RouteKey, string>>,
): string[] {
  return routes.flatMap((route) => {
    if (route.includes(':organizationId'))
      return [`${route}: tenant route mounted outside the tenant scope`];
    return Object.hasOwn(allowlist, route) ? [] : [`${route}: global route without justification`];
  });
}
