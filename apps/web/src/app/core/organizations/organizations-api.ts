import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type {
  CreateOrganizationRequest,
  InvitationPreview,
  MyOrganization,
  OrganizationDto,
} from '@taskflow/contracts';
import { ContractViolationError } from '../http/contract-guards';
import {
  isInvitationPreview,
  isMyOrganization,
  isMyOrganizationList,
  isOrganization,
} from './organizations-contract-guards';

/** Rotas sem organização ativa (ADR 0012). */
export const ORGANIZATIONS_API_PATHS = {
  mine: '/api/v1/me/organizations',
  create: '/api/v1/organizations',
  invitationLookup: '/api/v1/invitations/lookup',
  invitationAccept: '/api/v1/invitations/accept',
} as const;

/**
 * URL de um recurso tenant-scoped, montada com o id **resolvido da rota** `/o/:slug` (ADR 0012).
 * Não há interceptor que injete o tenant: cada chamada diz explicitamente a organização.
 */
export function tenantUrl(organizationId: string, suffix = ''): string {
  return `/api/v1/organizations/${encodeURIComponent(organizationId)}${suffix}`;
}

function checked<T>(body: unknown, guard: (value: unknown) => value is T, endpoint: string): T {
  if (!guard(body)) throw new ContractViolationError(endpoint);
  return body;
}

/** Organizações do usuário, criação e convites por token (spec 002). */
@Injectable({ providedIn: 'root' })
export class OrganizationsApi {
  private readonly http = inject(HttpClient);

  async listMine(): Promise<ReadonlyArray<MyOrganization>> {
    const path = ORGANIZATIONS_API_PATHS.mine;
    return checked(await firstValueFrom(this.http.get<unknown>(path)), isMyOrganizationList, path)
      .items;
  }

  async create(request: CreateOrganizationRequest): Promise<OrganizationDto> {
    const path = ORGANIZATIONS_API_PATHS.create;
    return checked(
      await firstValueFrom(this.http.post<unknown>(path, request)),
      isOrganization,
      path,
    );
  }

  async lookupInvitation(token: string): Promise<InvitationPreview> {
    const path = ORGANIZATIONS_API_PATHS.invitationLookup;
    const body = await firstValueFrom(this.http.post<unknown>(path, { token }));
    return checked(body, isInvitationPreview, path);
  }

  async acceptInvitation(token: string): Promise<MyOrganization> {
    const path = ORGANIZATIONS_API_PATHS.invitationAccept;
    const body = await firstValueFrom(this.http.post<unknown>(path, { token }));
    return checked(body, isMyOrganization, path);
  }
}
