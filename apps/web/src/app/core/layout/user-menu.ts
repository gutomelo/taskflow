import { ChangeDetectionStrategy, Component, inject, output } from '@angular/core';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { Router, RouterLink } from '@angular/router';
import { AuthStore } from '../auth';
import { layoutMessages } from './layout.messages';

/** Menu da conta no cabeçalho: segurança e logout (CA-07). */
@Component({
  selector: 'tf-user-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatMenu, MatMenuItem, MatMenuTrigger, RouterLink],
  template: `
    @if (store.user(); as user) {
      <button
        type="button"
        class="flex items-center gap-2 rounded-md px-2 py-1 text-sm font-medium hover:bg-primary/25 focus-visible:outline-2 focus-visible:outline-focus"
        [matMenuTriggerFor]="menu"
        [attr.aria-label]="messages.open(user.name)"
      >
        <span
          aria-hidden="true"
          class="flex size-8 items-center justify-center rounded-full bg-primary text-on-primary"
          >{{ initial(user.name) }}</span
        >
        <span class="hidden max-w-48 truncate sm:inline">{{ user.name }}</span>
      </button>
      <mat-menu #menu="matMenu" xPosition="before">
        <a mat-menu-item routerLink="/account/security">{{ messages.security }}</a>
        <button mat-menu-item type="button" (click)="signOut()">{{ messages.signOut }}</button>
      </mat-menu>
    }
  `,
})
export class UserMenu {
  protected readonly store = inject(AuthStore);
  private readonly router = inject(Router);
  protected readonly messages = layoutMessages.userMenu;
  /** Falha ao sair: o shell exibe a mensagem (o menu já fechou). */
  readonly signOutFailed = output<void>();

  protected initial(name: string): string {
    return [...name.trim()][0]?.toUpperCase() ?? '?';
  }

  protected async signOut(): Promise<void> {
    try {
      await this.store.signOut();
      await this.router.navigateByUrl('/login');
    } catch {
      this.signOutFailed.emit();
    }
  }
}
