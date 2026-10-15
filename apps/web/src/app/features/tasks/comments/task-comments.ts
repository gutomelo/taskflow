import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { MatButton } from '@angular/material/button';
import type { CommentDto } from '@taskflow/contracts';
import { ActiveProjectStore } from '../../projects/active-project.store';
import { TaskDetailStore } from '../task-detail.store';
import { absoluteTime, commentSegments, relativeTime } from './comment-body';
import { CommentComposer } from './comment-composer';
import { deserialize, type MentionDraft } from './mention-text';
import { CommentsStore } from './comments.store';
import { commentsMessages } from './comments.messages';

/** Comentários maiores que isto mostram "mostrar mais" (o texto nunca cobre a conversa). */
const COLLAPSE_AFTER = 600;

/**
 * Conversa da tarefa (spec 010, RF-01, RF-04, RF-05, RF-11): lista cronológica, carregar
 * anteriores, novo comentário, edição e exclusão com confirmação. Texto renderizado em pedaços
 * interpolados — nunca `innerHTML` (RNF-02). Ações só com capacidade da API.
 */
@Component({
  selector: 'tf-task-comments',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommentComposer, MatButton],
  providers: [CommentsStore],
  template: `
    <section class="mt-8 border-t border-border pt-4" aria-labelledby="comments-title">
      <h3 id="comments-title" tabindex="-1" class="text-sm font-semibold outline-none">
        {{ m.title(store.count()) }}
      </h3>
      <p class="sr-only" role="status" aria-live="polite">{{ store.announcement() }}</p>
      @if (store.error(); as message) {
        <p role="alert" class="mt-2 rounded-md bg-surface-muted px-4 py-3 text-sm text-error-text">
          {{ message }}
        </p>
      }
      @switch (store.status()) {
        @case ('loading') {
          <div class="mt-3 h-16 animate-pulse rounded-md bg-surface-muted" aria-hidden="true"></div>
          <p class="sr-only" role="status">{{ m.loading }}</p>
        }
        @case ('error') {
          <div class="mt-3" role="alert">
            <p class="text-sm text-error-text">{{ m.loadFailed }}</p>
            <button matButton="outlined" type="button" class="mt-2" (click)="reload()">
              {{ m.retry }}
            </button>
          </div>
        }
        @case ('loaded') {
          @if (store.hasOlder()) {
            <button matButton type="button" class="mt-2" (click)="store.loadOlder()">
              {{ m.loadOlder }}
            </button>
          }
          @if (store.items().length === 0) {
            <p class="mt-2 text-sm text-muted">{{ m.empty }}</p>
          }
          <ol class="mt-3 flex flex-col gap-4">
            @for (comment of store.items(); track comment.id) {
              <li>
                <article
                  [id]="'comment-' + comment.id"
                  tabindex="-1"
                  class="outline-none focus-visible:ring-2"
                  [attr.aria-labelledby]="'comment-author-' + comment.id"
                >
                  <header class="flex flex-wrap items-baseline gap-2 text-sm">
                    <span [id]="'comment-author-' + comment.id" class="font-semibold">
                      <bdi>{{ comment.author.name ?? m.formerMember }}</bdi>
                    </span>
                    <time
                      class="text-xs text-muted"
                      [attr.datetime]="comment.createdAt"
                      [title]="absolute(comment.createdAt)"
                      >{{ relative(comment.createdAt) }}</time
                    >
                    @if (comment.editedAt && !comment.deletedAt) {
                      <span
                        class="text-xs text-muted"
                        [title]="m.editedAt(absolute(comment.editedAt))"
                      >
                        ({{ m.edited }})
                      </span>
                    }
                  </header>
                  @if (comment.body === null) {
                    <p class="mt-1 text-sm italic text-muted">{{ m.removed }}</p>
                  } @else if (editingId() === comment.id) {
                    <div class="mt-1">
                      <tf-comment-composer
                        [label]="m.editLabel"
                        [hideLabel]="true"
                        [submitLabel]="m.save"
                        [cancellable]="true"
                        [initial]="draftOf(comment)"
                        [busy]="store.busy()"
                        (submitted)="saveEdit(comment, $event)"
                        (cancelled)="editingId.set(null)"
                      />
                    </div>
                  } @else {
                    <p
                      dir="auto"
                      class="mt-1 whitespace-pre-wrap break-words text-sm [unicode-bidi:isolate]"
                      [class.line-clamp-6]="collapsed(comment)"
                    >
                      @for (segment of segments(comment); track $index) {
                        @switch (segment.kind) {
                          @case ('text') {
                            <span>{{ segment.text }}</span>
                          }
                          @case ('newline') {
                            <br />
                          }
                          @case ('mention') {
                            <bdi class="rounded bg-surface-muted px-1 font-medium"
                              >&#64;{{ segment.name ?? m.formerMember }}</bdi
                            >
                          }
                          @case ('link') {
                            <a
                              class="text-primary underline"
                              [href]="segment.href"
                              target="_blank"
                              rel="noopener noreferrer nofollow"
                              ><bdi>{{ segment.label }}</bdi></a
                            >
                          }
                        }
                      }
                    </p>
                    @if (long(comment)) {
                      <button matButton type="button" (click)="toggle(comment.id)">
                        {{ expanded().has(comment.id) ? m.showLess : m.showMore }}
                      </button>
                    }
                  }
                  @if (editingId() !== comment.id) {
                    <div class="mt-1 flex flex-wrap gap-2">
                      @if (comment.actions.edit) {
                        <button matButton type="button" (click)="startEdit(comment)">
                          {{ m.edit }}
                        </button>
                      }
                      @if (comment.actions.delete) {
                        @if (confirmingId() === comment.id) {
                          <p class="w-full text-sm" role="alert">{{ m.confirmDelete }}</p>
                          <button
                            mat-flat-button
                            type="button"
                            [disabled]="store.busy()"
                            (click)="remove(comment)"
                          >
                            {{ m.confirm }}
                          </button>
                          <button matButton type="button" (click)="confirmingId.set(null)">
                            {{ m.cancel }}
                          </button>
                        } @else {
                          <button matButton type="button" (click)="confirmingId.set(comment.id)">
                            {{ m.delete }}
                          </button>
                        }
                      }
                    </div>
                  }
                </article>
              </li>
            }
          </ol>
          @if (store.canComment()) {
            <div class="mt-4">
              <tf-comment-composer
                #composer
                [label]="m.newComment"
                [submitLabel]="m.send"
                [busy]="store.busy()"
                (submitted)="send($event)"
              />
            </div>
          } @else {
            <p class="mt-4 text-sm text-muted" role="note">{{ readOnlyNotice() }}</p>
          }
        }
      }
    </section>
  `,
})
export class TaskComments {
  protected readonly store = inject(CommentsStore);
  private readonly task = inject(TaskDetailStore);
  private readonly project = inject(ActiveProjectStore);
  protected readonly m = commentsMessages;
  private readonly composer = viewChild<CommentComposer>('composer');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  protected readonly editingId = signal<string | null>(null);
  protected readonly confirmingId = signal<string | null>(null);
  protected readonly expanded = signal<ReadonlySet<string>>(new Set());
  private readonly now = signal(new Date());
  private readonly taskKey = computed(
    () => {
      const task = this.task.task();
      return task ? { taskId: task.id, canceledAt: task.canceledAt } : null;
    },
    {
      equal: (a, b) => a?.taskId === b?.taskId && a?.canceledAt === b?.canceledAt,
    },
  );

  protected readonly readOnlyNotice = computed(() => {
    if (this.project.project()?.archivedAt) return this.m.readOnlyArchived;
    if (this.task.task()?.canceledAt) return this.m.readOnlyCanceled;
    return this.m.readOnly;
  });

  constructor() {
    // A conversa acompanha a tarefa aberta; cancelar ou reabrir muda as ações (decisão 9). Outras
    // mudanças da tarefa (título, status) não recarregam.
    effect(() => {
      const taskId = this.taskKey()?.taskId;
      if (taskId) untracked(() => void this.store.load(taskId));
    });
  }

  protected reload(): Promise<void> {
    return this.store.load(this.store.taskId());
  }

  protected segments(comment: CommentDto) {
    return commentSegments(comment.body ?? '', comment.mentions);
  }

  protected relative(iso: string): string {
    return relativeTime(iso, this.now());
  }

  protected absolute(iso: string): string {
    return absoluteTime(iso);
  }

  protected long(comment: CommentDto): boolean {
    return (comment.body?.length ?? 0) > COLLAPSE_AFTER;
  }

  protected collapsed(comment: CommentDto): boolean {
    return this.long(comment) && !this.expanded().has(comment.id);
  }

  protected toggle(commentId: string): void {
    this.expanded.update((ids) => {
      const next = new Set(ids);
      if (!next.delete(commentId)) next.add(commentId);
      return next;
    });
  }

  protected async send(body: string): Promise<void> {
    this.now.set(new Date());
    if (await this.store.create(body)) this.composer()?.reset();
  }

  protected startEdit(comment: CommentDto): void {
    this.confirmingId.set(null);
    this.editingId.set(comment.id);
  }

  /** Texto do comentário para o composer: tokens viram `@Nome` com os intervalos (I7). */
  protected draftOf(comment: CommentDto): MentionDraft {
    return deserialize(comment.body ?? '', comment.mentions);
  }

  protected async saveEdit(comment: CommentDto, body: string): Promise<void> {
    if (!(await this.store.edit(comment, body))) return;
    this.editingId.set(null);
    // RNF-07: o composer de edição some; o foco volta ao comentário.
    this.focusAfterRender(() => this.host.nativeElement.querySelector(`#comment-${comment.id}`));
  }

  protected async remove(comment: CommentDto): Promise<void> {
    const removed = await this.store.remove(comment);
    this.confirmingId.set(null);
    if (!removed) return;
    // RNF-07: o botão de confirmação some; o foco vai para o composer (ou o título, em só leitura).
    this.focusAfterRender(
      () => this.composer()?.field() ?? this.host.nativeElement.querySelector('#comments-title'),
    );
  }

  private focusAfterRender(target: () => Element | null | undefined): void {
    afterNextRender(
      () => {
        const element = target();
        if (element instanceof HTMLElement) element.focus();
      },
      { injector: this.injector },
    );
  }
}
