import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  type OnInit,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { MatButton } from '@angular/material/button';
import type { MentionCandidate } from '@taskflow/contracts';
import { ActiveOrganizationStore } from '../../../core/organizations';
import { CommentApi } from './comment-api';
import { CommentsStore } from './comments.store';
import { commentsMessages } from './comments.messages';
import {
  activeQuery,
  applyEdit,
  EMPTY_DRAFT,
  insertMention,
  serialize,
  serializedLength,
  type MentionDraft,
} from './mention-text';

const MAX_LENGTH = 5000;
const SEARCH_DEBOUNCE_MS = 250;
let nextId = 0;

/**
 * Campo de comentário com menções (spec 010, RF-08, RNF-07): `textarea` com combobox — digitar
 * `@` e letras busca quem lê o projeto; setas escolhem, Enter ou Tab inserem, Esc fecha. O texto
 * mostra `@Nome`; o que sai é o serializado com `<@id>` (I7 da arquitetura). Sem `contenteditable`.
 */
@Component({
  selector: 'tf-comment-composer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButton],
  template: `
    <form class="flex flex-col gap-2" (submit)="submit($event)">
      <label [for]="fieldId" [class.sr-only]="hideLabel()" class="text-sm font-medium">{{
        label()
      }}</label>
      <div class="relative">
        <textarea
          #field
          [id]="fieldId"
          class="w-full rounded-md border border-border bg-surface px-2 py-1 text-sm"
          rows="3"
          role="combobox"
          aria-autocomplete="list"
          [attr.aria-expanded]="open()"
          [attr.aria-controls]="listId"
          [attr.aria-activedescendant]="activeOptionId()"
          [attr.aria-describedby]="counterId"
          [value]="draft().text"
          (input)="onInput()"
          (keydown)="onKeydown($event)"
          (click)="onCaretMove()"
          (blur)="close()"
        ></textarea>
        <ul
          [id]="listId"
          role="listbox"
          [attr.aria-label]="m.mentionSuggestions"
          class="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-md border border-border bg-surface shadow"
          [hidden]="!open()"
        >
          @for (candidate of candidates(); track candidate.userId; let index = $index) {
            <li
              [id]="optionId(index)"
              role="option"
              class="cursor-pointer px-2 py-1 text-sm"
              [class.bg-surface-muted]="index === active()"
              [attr.aria-selected]="index === active()"
              (mousedown)="$event.preventDefault(); choose(candidate)"
            >
              <bdi>{{ candidate.name }}</bdi>
              <span class="text-xs text-muted"> {{ candidate.email }}</span>
            </li>
          }
        </ul>
      </div>
      <p [id]="counterId" class="text-xs text-muted">{{ m.counter(length(), maxLength) }}</p>
      <div class="flex gap-2">
        <button
          mat-flat-button
          type="submit"
          [disabled]="busy() || blank() || length() > maxLength"
        >
          {{ busy() ? m.sending : submitLabel() }}
        </button>
        @if (cancellable()) {
          <button matButton type="button" (click)="cancelled.emit()">{{ m.cancel }}</button>
        }
      </div>
    </form>
  `,
})
export class CommentComposer implements OnInit {
  private readonly api = inject(CommentApi);
  private readonly organization = inject(ActiveOrganizationStore);
  private readonly comments = inject(CommentsStore);
  protected readonly m = commentsMessages;
  protected readonly maxLength = MAX_LENGTH;

  readonly label = input.required<string>();
  readonly submitLabel = input.required<string>();
  readonly hideLabel = input(false);
  readonly cancellable = input(false);
  readonly busy = input(false);
  readonly initial = input<MentionDraft>(EMPTY_DRAFT);
  /** Texto serializado (`<@id>`) para a API. */
  readonly submitted = output<string>();
  readonly cancelled = output<void>();

  private readonly fieldRef = viewChild.required<ElementRef<HTMLTextAreaElement>>('field');
  protected readonly fieldId = `comment-field-${(nextId += 1)}`;
  protected readonly listId = `${this.fieldId}-mentions`;
  protected readonly counterId = `${this.fieldId}-counter`;
  protected readonly draft = signal<MentionDraft>(EMPTY_DRAFT);
  protected readonly candidates = signal<ReadonlyArray<MentionCandidate>>([]);
  protected readonly active = signal(0);
  protected readonly open = computed(() => this.candidates().length > 0);
  protected readonly activeOptionId = computed(() =>
    this.open() ? this.optionId(this.active()) : null,
  );
  protected readonly length = computed(() => serializedLength(this.draft()));
  protected readonly blank = computed(() => this.draft().text.trim() === '');
  private query: Readonly<{ start: number; query: string }> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private searches = 0;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.clearTimer());
  }

  ngOnInit(): void {
    this.draft.set(this.initial());
  }

  /** O campo de texto (quem usa devolve o foco a ele). */
  field(): HTMLTextAreaElement {
    return this.fieldRef().nativeElement;
  }

  /** Limpa depois de enviado (quem usa decide, pela resposta da API). */
  reset(): void {
    this.draft.set(EMPTY_DRAFT);
    this.close();
  }

  protected optionId(index: number): string {
    return `${this.listId}-${index}`;
  }

  protected onInput(): void {
    const element = this.fieldRef().nativeElement;
    this.draft.update((draft) => applyEdit(draft, element.value));
    this.onCaretMove();
  }

  protected onCaretMove(): void {
    const element = this.fieldRef().nativeElement;
    this.query = activeQuery(this.draft(), element.selectionStart);
    this.clearTimer();
    if (!this.query) {
      this.close();
      return;
    }
    const { query } = this.query;
    this.timer = setTimeout(() => void this.search(query), SEARCH_DEBOUNCE_MS);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (!this.open()) return;
    const count = this.candidates().length;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : count - 1;
      this.active.update((index) => (index + step) % count);
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      const candidate = this.candidates()[this.active()];
      if (!candidate) return;
      event.preventDefault();
      this.choose(candidate);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
    }
  }

  protected choose(candidate: MentionCandidate): void {
    const element = this.fieldRef().nativeElement;
    const query = this.query;
    if (!query) return;
    const { draft, caret } = insertMention(this.draft(), query.start, element.selectionStart, {
      userId: candidate.userId,
      name: candidate.name,
    });
    this.draft.set(draft);
    this.close();
    // O `[value]` é aplicado na próxima detecção; o cursor vai para depois da menção.
    element.value = draft.text;
    element.setSelectionRange(caret, caret);
    element.focus();
  }

  protected close(): void {
    this.searches += 1;
    this.candidates.set([]);
    this.active.set(0);
  }

  protected submit(event: Event): void {
    event.preventDefault();
    if (this.busy() || this.blank() || this.length() > MAX_LENGTH) return;
    this.submitted.emit(serialize(this.draft()));
  }

  private async search(query: string): Promise<void> {
    const search = (this.searches += 1);
    try {
      const page = await this.api.candidates(
        this.organization.requireId(),
        this.comments.taskId(),
        query,
      );
      // Só a busca mais recente vale (respostas fora de ordem).
      if (search !== this.searches) return;
      this.candidates.set(page.items);
      this.active.set(0);
    } catch {
      // Sugestão é ajuda, não requisito: sem ela, o texto continua editável.
      if (search === this.searches) this.candidates.set([]);
    }
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
