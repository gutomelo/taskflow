import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Moldura das páginas de visitante: título, subtítulo e conteúdo centralizados. */
@Component({
  selector: 'tf-auth-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block px-4 py-10 sm:py-16' },
  template: `
    <section
      class="mx-auto w-full max-w-md rounded-lg border border-border bg-surface p-6 shadow-sm sm:p-8"
      [attr.aria-labelledby]="headingId()"
    >
      <h1 [id]="headingId()" class="text-2xl font-semibold tracking-tight">{{ heading() }}</h1>
      @if (subtitle()) {
        <p class="mt-1 text-sm text-muted">{{ subtitle() }}</p>
      }
      <div class="mt-6">
        <ng-content />
      </div>
    </section>
  `,
})
export class AuthCard {
  readonly heading = input.required<string>();
  readonly subtitle = input<string>('');
  readonly headingId = input('auth-card-title');
}
