import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { debounceTime, distinctUntilChanged } from 'rxjs';
import type { PasswordRule } from '@taskflow/contracts';
import { authMessages } from './auth.messages';
import { unmetPasswordRules } from './password-policy';

/** Regras sempre visíveis; as demais aparecem só quando violadas. */
const ALWAYS_SHOWN: ReadonlyArray<PasswordRule> = [
  'min_length',
  'uppercase',
  'lowercase',
  'digit',
  'symbol',
  'same_as_email',
];

/** Intervalo sem digitação antes de anunciar: anunciar a cada tecla seria ruído. */
export const ANNOUNCE_DEBOUNCE_MS = 700;

/**
 * Requisitos de senha em tempo real (CA-12). A lista visual atualiza a cada tecla, com ícone e
 * texto de estado (não depende só de cor); o leitor de tela recebe um resumo com debounce.
 */
@Component({
  selector: 'tf-password-requirements',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="mb-1 text-sm text-muted">{{ messages.heading }}</p>
    <ul class="space-y-1 text-sm" data-testid="password-requirements">
      @for (rule of rules(); track rule.id) {
        <li
          class="flex items-center gap-2"
          [class.text-success-text]="rule.met"
          [class.text-muted]="!rule.met"
          [attr.data-rule]="rule.id"
          [attr.data-met]="rule.met"
        >
          <svg aria-hidden="true" viewBox="0 0 16 16" class="size-4 shrink-0" fill="none">
            @if (rule.met) {
              <path
                d="M3 8.5l3 3 7-7"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            } @else {
              <circle cx="8" cy="8" r="5" stroke="currentColor" stroke-width="1.5" />
            }
          </svg>
          <span>{{ rule.label }}</span>
          <span class="sr-only">— {{ rule.met ? messages.met : messages.pending }}</span>
        </li>
      }
    </ul>
    <p class="sr-only" aria-live="polite" data-testid="password-requirements-live">
      {{ announcement() }}
    </p>
  `,
})
export class PasswordRequirements {
  readonly password = input.required<string>();
  readonly email = input<string>('');
  /** Regras recusadas pelo servidor para a senha enviada (inclui `common_password`). */
  readonly serverViolations = input<ReadonlyArray<PasswordRule>>([]);

  protected readonly messages = authMessages.passwordRequirements;

  readonly unmet = computed(() => {
    const unmet = new Set(unmetPasswordRules(this.password(), this.email()));
    for (const rule of this.serverViolations()) unmet.add(rule);
    return unmet;
  });

  protected readonly rules = computed(() => {
    const unmet = this.unmet();
    const shown = [
      ...ALWAYS_SHOWN,
      ...(['max_length', 'common_password'] as const).filter((rule) => unmet.has(rule)),
    ];
    return shown.map((id) => ({ id, label: this.messages.rules[id], met: !unmet.has(id) }));
  });

  private readonly summary = computed(() => {
    if (this.password().length === 0) return '';
    const pending = this.rules().filter((rule) => !rule.met);
    return pending.length === 0
      ? this.messages.allMet
      : this.messages.pendingSummary(pending.map((rule) => rule.label));
  });

  protected readonly announcement = toSignal(
    toObservable(this.summary).pipe(debounceTime(ANNOUNCE_DEBOUNCE_MS), distinctUntilChanged()),
    { initialValue: '' },
  );
}
