import { computed, inject, Injectable, signal } from '@angular/core';
import type { InvitableRole, InvitationDto } from '@taskflow/contracts';
import { toApiProblem, type ApiProblem } from '../../core/http/api-problem';
import { ActiveOrganizationStore } from '../../core/organizations';
import { OrganizationApi } from './organization-api';

/** Convites abertos da organização ativa (RF-06, RF-07). Só owner/admin chegam a usá-lo. */
@Injectable()
export class InvitationsStore {
  private readonly api = inject(OrganizationApi);
  private readonly active = inject(ActiveOrganizationStore);

  private readonly state = signal<{
    status: 'loading' | 'loaded' | 'error';
    items: ReadonlyArray<InvitationDto>;
    nextCursor: string | null;
  }>({ status: 'loading', items: [], nextCursor: null });
  readonly busy = signal<string | null>(null);
  readonly loadingMore = signal(false);

  readonly status = computed(() => this.state().status);
  readonly items = computed(() => this.state().items);
  readonly hasMore = computed(() => this.state().nextCursor !== null);

  async load(): Promise<void> {
    this.state.set({ status: 'loading', items: [], nextCursor: null });
    try {
      const page = await this.api.invitations(this.active.requireId(), null);
      this.state.set({ status: 'loaded', items: page.items, nextCursor: page.nextCursor });
    } catch {
      this.state.update((state) => ({ ...state, status: 'error' }));
    }
  }

  /** Uma página por vez: clique duplo não busca o mesmo cursor duas vezes (linhas duplicadas). */
  async loadMore(): Promise<void> {
    const { nextCursor } = this.state();
    if (!nextCursor || this.loadingMore()) return;
    this.loadingMore.set(true);
    try {
      const page = await this.api.invitations(this.active.requireId(), nextCursor);
      this.state.update((state) => ({
        status: 'loaded',
        items: [...state.items, ...page.items],
        nextCursor: page.nextCursor,
      }));
    } finally {
      this.loadingMore.set(false);
    }
  }

  /** `created` diferencia convite novo de reconvite (papel atualizado e reenviado). */
  async invite(
    email: string,
    role: InvitableRole,
  ): Promise<{ problem: ApiProblem } | { invitation: InvitationDto; created: boolean }> {
    try {
      const { invitation, created } = await this.api.invite(this.active.requireId(), email, role);
      // Reconvite de um convite fora das páginas carregadas: entra na lista como os demais.
      const known = this.state().items.some((item) => item.id === invitation.id);
      this.state.update((state) => ({
        ...state,
        items: known
          ? state.items.map((item) => (item.id === invitation.id ? invitation : item))
          : [...state.items, invitation],
      }));
      return { invitation, created };
    } catch (error) {
      return { problem: toApiProblem(error) };
    }
  }

  resend(invitation: InvitationDto): Promise<ApiProblem | null> {
    return this.run(invitation, async () => {
      await this.api.resend(this.active.requireId(), invitation.id);
      // Prazo renovado e convidante atualizado no servidor: a lista volta da fonte.
      await this.load();
    });
  }

  revoke(invitation: InvitationDto): Promise<ApiProblem | null> {
    return this.run(invitation, async () => {
      await this.api.revoke(this.active.requireId(), invitation.id);
      this.state.update((state) => ({
        ...state,
        items: state.items.filter((item) => item.id !== invitation.id),
      }));
    });
  }

  private async run(
    invitation: InvitationDto,
    work: () => Promise<void>,
  ): Promise<ApiProblem | null> {
    if (this.busy() !== null) return null;
    this.busy.set(invitation.id);
    try {
      await work();
      return null;
    } catch (error) {
      const problem = toApiProblem(error);
      if (problem.code === 'INVITATION_NOT_FOUND') await this.load();
      return problem;
    } finally {
      this.busy.set(null);
    }
  }
}
