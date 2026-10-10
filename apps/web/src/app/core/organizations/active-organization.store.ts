import { computed, inject, Injectable, signal } from '@angular/core';
import type { MyOrganization } from '@taskflow/contracts';
import { MyOrganizationsStore } from './my-organizations.store';

/**
 * Organização aberta em `/o/:slug`. Provido no componente da área da organização, que o router
 * recria quando o slug muda (`OrganizationRouteReuseStrategy`): stores filhos nunca misturam
 * dados de duas organizações.
 */
@Injectable()
export class ActiveOrganizationStore {
  private readonly source = signal<() => MyOrganization | null>(() => null);
  private readonly mine = inject(MyOrganizationsStore);

  /**
   * A resolvida pela rota, atualizada pela entrada atual de "minhas organizações": o próprio
   * papel alterado ou o nome renomeado aparecem sem recarregar a página.
   */
  readonly organization = computed(() => {
    const resolved = this.source()();
    if (!resolved) return null;
    return this.mine.items().find((item) => item.id === resolved.id) ?? resolved;
  });
  readonly id = computed(() => this.organization()?.id ?? null);
  readonly role = computed(() => this.organization()?.role ?? null);
  /** Ações de gestão (BR-021): a API decide; a interface só esconde o que seria negado. */
  readonly canManage = computed(() => this.role() === 'owner' || this.role() === 'admin');

  /** Liga o store à organização resolvida pela rota (sinal de input do layout). */
  connect(source: () => MyOrganization | null): void {
    this.source.set(source);
  }

  /** Id para as URLs; falha alto se usado fora da área da organização. */
  requireId(): string {
    const id = this.id();
    if (!id) throw new Error('No active organization');
    return id;
  }
}
