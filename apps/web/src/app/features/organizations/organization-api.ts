import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type {
  InvitableRole,
  InvitationDto,
  InvitationPage,
  Member,
  MemberPage,
  OrganizationDto,
  OrganizationRole,
} from '@taskflow/contracts';
import { ContractViolationError } from '../../core/http/contract-guards';
import {
  isInvitation,
  isInvitationPage,
  isMember,
  isMemberPage,
  isOrganization,
  tenantUrl,
} from '../../core/organizations';

function checked<T>(body: unknown, guard: (value: unknown) => value is T, endpoint: string): T {
  if (!guard(body)) throw new ContractViolationError(endpoint);
  return body;
}

const page = (cursor: string | null) =>
  cursor ? new HttpParams().set('cursor', cursor) : new HttpParams();

/**
 * Recursos da organização ativa (spec 002). Toda chamada recebe o id explícito da organização
 * resolvida em `/o/:slug` — nunca um tenant implícito (ADR 0012).
 */
@Injectable({ providedIn: 'root' })
export class OrganizationApi {
  private readonly http = inject(HttpClient);

  async get(organizationId: string): Promise<OrganizationDto> {
    const url = tenantUrl(organizationId);
    return checked(await firstValueFrom(this.http.get<unknown>(url)), isOrganization, url);
  }

  async rename(organizationId: string, name: string, version: number): Promise<OrganizationDto> {
    const url = tenantUrl(organizationId);
    const body = await firstValueFrom(this.http.patch<unknown>(url, { name, version }));
    return checked(body, isOrganization, url);
  }

  async members(organizationId: string, cursor: string | null): Promise<MemberPage> {
    const url = tenantUrl(organizationId, '/members');
    const body = await firstValueFrom(this.http.get<unknown>(url, { params: page(cursor) }));
    return checked(body, isMemberPage, url);
  }

  async changeRole(
    organizationId: string,
    member: Pick<Member, 'userId' | 'version'>,
    role: OrganizationRole,
  ): Promise<Member> {
    const url = tenantUrl(organizationId, `/members/${encodeURIComponent(member.userId)}`);
    const body = await firstValueFrom(
      this.http.patch<unknown>(url, { role, version: member.version }),
    );
    return checked(body, isMember, url);
  }

  /** Remove o membro; o próprio usuário = sair (RF-12). */
  removeMember(organizationId: string, member: Pick<Member, 'userId' | 'version'>): Promise<void> {
    const url = tenantUrl(organizationId, `/members/${encodeURIComponent(member.userId)}`);
    const params = new HttpParams().set('version', member.version);
    return firstValueFrom(this.http.delete<void>(url, { params }));
  }

  async invitations(organizationId: string, cursor: string | null): Promise<InvitationPage> {
    const url = tenantUrl(organizationId, '/invitations');
    const body = await firstValueFrom(this.http.get<unknown>(url, { params: page(cursor) }));
    return checked(body, isInvitationPage, url);
  }

  /** 201 = convite novo; 200 = convite aberto atualizado e reenviado (design, tabela de endpoints). */
  async invite(
    organizationId: string,
    email: string,
    role: InvitableRole,
  ): Promise<{ invitation: InvitationDto; created: boolean }> {
    const url = tenantUrl(organizationId, '/invitations');
    const response = await firstValueFrom(
      this.http.post<unknown>(url, { email, role }, { observe: 'response' }),
    );
    return {
      invitation: checked(response.body, isInvitation, url),
      created: response.status === 201,
    };
  }

  resend(organizationId: string, invitationId: string): Promise<void> {
    const url = tenantUrl(
      organizationId,
      `/invitations/${encodeURIComponent(invitationId)}/resend`,
    );
    return firstValueFrom(this.http.post<void>(url, null));
  }

  revoke(organizationId: string, invitationId: string): Promise<void> {
    const url = tenantUrl(organizationId, `/invitations/${encodeURIComponent(invitationId)}`);
    return firstValueFrom(this.http.delete<void>(url));
  }
}
