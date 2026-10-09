import { afterNextRender, type ElementRef, type Injector } from '@angular/core';
import type { AbstractControl } from '@angular/forms';

/** Foca o primeiro campo inválido na ordem do formulário (RNF-10: foco no primeiro erro). */
export function focusFirstInvalid(
  fields: ReadonlyArray<readonly [AbstractControl, ElementRef<HTMLElement> | undefined]>,
): void {
  fields.find(([control]) => control.invalid)?.[1]?.nativeElement.focus();
}

/** Foca o elemento depois da próxima renderização (ex.: alerta que acabou de aparecer). */
export function focusAfterRender(
  element: () => ElementRef<HTMLElement> | undefined,
  injector: Injector,
): void {
  afterNextRender(() => element()?.nativeElement.focus(), { injector });
}
