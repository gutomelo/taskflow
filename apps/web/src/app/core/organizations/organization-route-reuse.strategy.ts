import { Injectable } from '@angular/core';
import { BaseRouteReuseStrategy, type ActivatedRouteSnapshot } from '@angular/router';

/** Marca a rota cujo componente deve ser recriado quando os parâmetros mudam. */
export const RECREATE_ON_PARAM_CHANGE = 'recreateOnParamChange';

/**
 * Trocar `/o/acme` por `/o/beta` recria a área da organização (e os stores providos nela) em vez
 * de reaproveitar o componente com dados da organização anterior (design, "Troca de organização").
 */
@Injectable()
export class OrganizationRouteReuseStrategy extends BaseRouteReuseStrategy {
  override shouldReuseRoute(
    future: ActivatedRouteSnapshot,
    current: ActivatedRouteSnapshot,
  ): boolean {
    if (future.routeConfig !== current.routeConfig) return false;
    if (future.routeConfig?.data?.[RECREATE_ON_PARAM_CHANGE] !== true) return true;
    return JSON.stringify(future.params) === JSON.stringify(current.params);
  }
}
