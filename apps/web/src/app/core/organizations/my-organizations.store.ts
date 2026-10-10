import { computed, inject, Injectable, signal } from '@angular/core';
import type { MyOrganization } from '@taskflow/contracts';
import { AuthStore } from '../auth';
import { OrganizationsApi } from './organizations-api';

type State = Readonly<{
  status: 'idle' | 'loading' | 'loaded' | 'error';
  items: ReadonlyArray<MyOrganization>;
}>;

/**
 * "Minhas organizações" (RF-02) e resolução do slug da URL (`/o/:slug`). Estado em Signals
 * (ADR 0009). O servidor continua sendo a autoridade: este store só escolhe qual id usar nas URLs.
 */
@Injectable({ providedIn: 'root' })
export class MyOrganizationsStore {
  private readonly api = inject(OrganizationsApi);
  private readonly auth = inject(AuthStore);
  private readonly state = signal<State>({ status: 'idle', items: [] });
  private pending: Promise<void> | null = null;
  /** Usuário dono da lista (ou da busca em andamento): só a troca de usuário a descarta. */
  private owner: string | null = null;
  /** Muda quando o dono muda: respostas buscadas para outro usuário são descartadas. */
  private generation = 0;

  readonly status = computed(() => this.state().status);
  readonly items = computed(() => this.state().items);

  /** Carrega uma vez; chamadas concorrentes compartilham a mesma requisição. */
  ensureLoaded(): Promise<void> {
    return this.state().status === 'loaded' ? Promise.resolve() : this.reload();
  }

  reload(): Promise<void> {
    this.pending ??= this.fetch().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  /**
   * Organização do slug. Sem correspondência, recarrega **uma vez** antes de desistir: quem acabou
   * de aceitar um convite ou criar em outra aba ainda não está na lista em memória.
   */
  async resolve(slug: string): Promise<MyOrganization | null> {
    await this.ensureLoaded();
    const found = this.find(slug);
    if (found) return found;
    await this.reload();
    return this.find(slug);
  }

  /**
   * Recém-criada, aceita ou alterada (nome, papel): atualiza a lista **já carregada**. Sem lista
   * carregada (início, após `reset` ou `invalidate`), não inventa uma lista parcial — a próxima
   * leitura busca do servidor.
   */
  add(organization: MyOrganization): void {
    if (this.state().status !== 'loaded') return;
    const items = this.state().items;
    const exists = items.some((item) => item.id === organization.id);
    this.state.set({
      status: 'loaded',
      items: exists
        ? items.map((item) => (item.id === organization.id ? organization : item))
        : [...items, organization],
    });
  }

  /** 404 tenant-scoped (removido, organização apagada): a próxima leitura busca de novo. */
  invalidate(): void {
    if (this.state().status === 'loaded')
      this.state.update((state) => ({ ...state, status: 'idle' }));
  }

  /** Sessão encerrada ou trocada: nada da conta anterior permanece em memória. */
  reset(): void {
    this.generation += 1;
    this.pending = null;
    this.owner = null;
    this.state.set({ status: 'idle', items: [] });
  }

  /**
   * A sessão passou a ser de `userId` (ou de ninguém). Só descarta lista e buscas de **outro**
   * usuário: a busca que o guard de `/` já iniciou para quem acabou de entrar é mantida.
   */
  syncUser(userId: string | null): void {
    if (this.owner !== null && this.owner !== userId) this.reset();
  }

  private find(slug: string): MyOrganization | null {
    return this.state().items.find((item) => item.slug === slug) ?? null;
  }

  private async fetch(): Promise<void> {
    this.owner = this.auth.user()?.id ?? null;
    const generation = this.generation;
    this.state.update((state) => ({ ...state, status: 'loading' }));
    try {
      const items = await this.api.listMine();
      if (generation === this.generation) this.state.set({ status: 'loaded', items });
    } catch (error) {
      if (generation === this.generation) {
        this.state.update((state) => ({ ...state, status: 'error' }));
      }
      throw error;
    }
  }
}
