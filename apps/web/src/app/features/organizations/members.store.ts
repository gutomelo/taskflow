import { computed, inject, Injectable, signal } from '@angular/core';
import type { Member, OrganizationRole } from '@taskflow/contracts';
import { toApiProblem, type ApiProblem } from '../../core/http/api-problem';
import { ActiveOrganizationStore } from '../../core/organizations';
import { OrganizationApi } from './organization-api';

type LoadStatus = 'loading' | 'loaded' | 'error';

/** Membros da organização ativa (RF-09…RF-12). Provido na página; recriado com a área. */
@Injectable()
export class MembersStore {
  private readonly api = inject(OrganizationApi);
  private readonly active = inject(ActiveOrganizationStore);

  private readonly state = signal<{
    status: LoadStatus;
    items: ReadonlyArray<Member>;
    nextCursor: string | null;
  }>({ status: 'loading', items: [], nextCursor: null });
  /** Membro com operação em andamento (uma por vez). */
  readonly busy = signal<string | null>(null);
  readonly loadingMore = signal(false);

  readonly status = computed(() => this.state().status);
  readonly items = computed(() => this.state().items);
  readonly hasMore = computed(() => this.state().nextCursor !== null);

  async load(): Promise<void> {
    this.state.set({ status: 'loading', items: [], nextCursor: null });
    try {
      const page = await this.api.members(this.active.requireId(), null);
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
      const page = await this.api.members(this.active.requireId(), nextCursor);
      this.state.update((state) => ({
        status: 'loaded',
        items: [...state.items, ...page.items],
        nextCursor: page.nextCursor,
      }));
    } finally {
      this.loadingMore.set(false);
    }
  }

  /** Devolve o problema da API (para a mensagem) ou `null` em caso de sucesso. */
  async changeRole(member: Member, role: OrganizationRole): Promise<ApiProblem | null> {
    return this.run(member, async () => {
      const updated = await this.api.changeRole(this.active.requireId(), member, role);
      this.replace(updated);
    });
  }

  async remove(member: Member): Promise<ApiProblem | null> {
    return this.run(member, async () => {
      await this.api.removeMember(this.active.requireId(), member);
      this.state.update((state) => ({
        ...state,
        items: state.items.filter((item) => item.userId !== member.userId),
      }));
    });
  }

  private replace(updated: Member): void {
    this.state.update((state) => ({
      ...state,
      items: state.items.map((item) => (item.userId === updated.userId ? updated : item)),
    }));
  }

  private async run(member: Member, work: () => Promise<void>): Promise<ApiProblem | null> {
    if (this.busy() !== null) return null;
    this.busy.set(member.userId);
    try {
      await work();
      return null;
    } catch (error) {
      const problem = toApiProblem(error);
      // Lista desatualizada (versão, membro já removido): recarrega para refletir o servidor.
      if (problem.code === 'VERSION_CONFLICT' || problem.code === 'MEMBER_NOT_FOUND') {
        await this.load();
      }
      return problem;
    } finally {
      this.busy.set(null);
    }
  }
}
