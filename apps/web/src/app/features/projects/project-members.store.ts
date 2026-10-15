import { computed, inject, Injectable, signal } from '@angular/core';
import type { MemberCandidate, ProjectMemberDto, ProjectRole } from '@taskflow/contracts';
import { toApiProblem, type ApiProblem } from '../../core/http/api-problem';
import { ActiveOrganizationStore } from '../../core/organizations';
import { ActiveProjectStore } from './active-project.store';
import { ProjectApi } from './project-api';

type Status = 'loading' | 'loaded' | 'error';
type Page<T> = { status: Status; items: ReadonlyArray<T>; nextCursor: string | null };

const loadingPage = <T>(): Page<T> => ({ status: 'loading', items: [], nextCursor: null });

/** Participantes e candidatos do projeto ativo (RF-06…RF-08). Provido na página. */
@Injectable()
export class ProjectMembersStore {
  private readonly api = inject(ProjectApi);
  private readonly organization = inject(ActiveOrganizationStore);
  private readonly project = inject(ActiveProjectStore);

  private readonly members = signal<Page<ProjectMemberDto>>(loadingPage());
  private readonly candidatePage = signal<Page<MemberCandidate>>(loadingPage());
  /** Participante (ou candidato) com operação em andamento: uma por vez. */
  readonly busy = signal<string | null>(null);
  readonly loadingMore = signal(false);

  readonly status = computed(() => this.members().status);
  readonly items = computed(() => this.members().items);
  readonly hasMore = computed(() => this.members().nextCursor !== null);
  readonly candidatesStatus = computed(() => this.candidatePage().status);
  readonly candidates = computed(() => this.candidatePage().items);
  readonly hasMoreCandidates = computed(() => this.candidatePage().nextCursor !== null);

  private ids() {
    return [this.organization.requireId(), this.project.requireId()] as const;
  }

  async load(): Promise<void> {
    this.members.set(loadingPage());
    try {
      const page = await this.api.members(...this.ids(), null);
      this.members.set({ status: 'loaded', items: page.items, nextCursor: page.nextCursor });
    } catch (error) {
      if (!this.project.handle(error))
        this.members.update((state) => ({ ...state, status: 'error' }));
    }
  }

  /** Uma página por vez: clique duplo não busca o mesmo cursor duas vezes. */
  async loadMore(): Promise<void> {
    const { nextCursor } = this.members();
    if (!nextCursor || this.loadingMore()) return;
    this.loadingMore.set(true);
    try {
      const page = await this.api.members(...this.ids(), nextCursor);
      this.members.update((state) => ({
        status: 'loaded',
        items: [...state.items, ...page.items],
        nextCursor: page.nextCursor,
      }));
    } catch (error) {
      if (!this.project.handle(error))
        this.members.update((state) => ({ ...state, status: 'error' }));
    } finally {
      this.loadingMore.set(false);
    }
  }

  /** Só para quem gerencia o projeto ativo (a página decide pela capacidade). */
  async loadCandidates(more = false): Promise<void> {
    const cursor = more ? this.candidatePage().nextCursor : null;
    if (more && !cursor) return;
    if (!more) this.candidatePage.set(loadingPage());
    try {
      const page = await this.api.candidates(...this.ids(), cursor);
      this.candidatePage.update((state) => ({
        status: 'loaded',
        items: more ? [...state.items, ...page.items] : page.items,
        nextCursor: page.nextCursor,
      }));
    } catch (error) {
      if (!this.project.handle(error)) {
        this.candidatePage.update((state) => ({ ...state, status: 'error' }));
      }
    }
  }

  /** Devolve o problema da API (para a mensagem) ou `null` em caso de sucesso. */
  add(candidate: MemberCandidate, role: ProjectRole): Promise<ApiProblem | null> {
    return this.run(candidate.userId, async () => {
      const added = await this.api.addMember(...this.ids(), candidate.userId, role);
      this.members.update((state) => ({ ...state, items: [...state.items, added] }));
      this.candidatePage.update((state) => ({
        ...state,
        items: state.items.filter((item) => item.userId !== candidate.userId),
      }));
    });
  }

  changeRole(member: ProjectMemberDto, role: ProjectRole): Promise<ApiProblem | null> {
    return this.run(member.userId, async () => {
      const updated = await this.api.changeRole(...this.ids(), member, role);
      this.members.update((state) => ({
        ...state,
        items: state.items.map((item) => (item.userId === updated.userId ? updated : item)),
      }));
    });
  }

  remove(member: ProjectMemberDto): Promise<ApiProblem | null> {
    return this.run(member.userId, async () => {
      await this.api.removeMember(...this.ids(), member);
      this.members.update((state) => ({
        ...state,
        items: state.items.filter((item) => item.userId !== member.userId),
      }));
    });
  }

  private async run(userId: string, work: () => Promise<void>): Promise<ApiProblem | null> {
    if (this.busy()) return null;
    this.busy.set(userId);
    try {
      await work();
      return null;
    } catch (error) {
      if (this.project.handle(error)) return null;
      return toApiProblem(error);
    } finally {
      this.busy.set(null);
    }
  }
}
