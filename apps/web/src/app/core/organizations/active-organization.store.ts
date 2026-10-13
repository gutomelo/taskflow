import { computed, inject, Injectable, signal } from '@angular/core';
import type { MyOrganization, OrganizationPermission } from '@taskflow/contracts';
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
  private readonly capabilities = computed(
    () => new Set<string>(this.organization()?.capabilities ?? []),
  );

  /**
   * Capacidade calculada pela API (spec 006): a interface esconde o que seria negado, sem matriz
   * própria. Dica apenas — a API decide toda ação. Se a última recarga de "minhas organizações"
   * falhou, as capacidades em memória podem estar velhas (ex.: o próprio papel acabou de mudar) e
   * nada é oferecido até a próxima recarga bem-sucedida.
   */
  can(permission: OrganizationPermission): boolean {
    return this.mine.status() !== 'error' && this.capabilities().has(permission);
  }

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
