import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { CommentDto, CommentPage, MentionCandidatePage } from '@taskflow/contracts';
import { ContractViolationError } from '../../../core/http/contract-guards';
import { tenantUrl } from '../../../core/organizations';
import { isComment, isCommentPage, isMentionCandidatePage } from './comments-contract-guards';

function checked<T>(body: unknown, guard: (value: unknown) => value is T, endpoint: string): T {
  if (!guard(body)) throw new ContractViolationError(endpoint);
  return body;
}

type Versioned = Pick<CommentDto, 'id' | 'version'>;

/** Comentários e menções da organização ativa (spec 010; id explícito da organização, ADR 0012). */
@Injectable({ providedIn: 'root' })
export class CommentApi {
  private readonly http = inject(HttpClient);

  async page(organizationId: string, taskId: string, cursor: string | null): Promise<CommentPage> {
    const url = tenantUrl(organizationId, `/tasks/${taskId}/comments`);
    const params = cursor ? new HttpParams().set('cursor', cursor) : new HttpParams();
    return checked(
      await firstValueFrom(this.http.get<unknown>(url, { params })),
      isCommentPage,
      url,
    );
  }

  async get(organizationId: string, commentId: string): Promise<CommentDto> {
    const url = tenantUrl(organizationId, `/comments/${commentId}`);
    return checked(await firstValueFrom(this.http.get<unknown>(url)), isComment, url);
  }

  async create(organizationId: string, taskId: string, body: string): Promise<CommentDto> {
    const url = tenantUrl(organizationId, `/tasks/${taskId}/comments`);
    return checked(await firstValueFrom(this.http.post<unknown>(url, { body })), isComment, url);
  }

  async edit(organizationId: string, comment: Versioned, body: string): Promise<CommentDto> {
    const url = tenantUrl(organizationId, `/comments/${comment.id}`);
    return checked(
      await firstValueFrom(this.http.patch<unknown>(url, { body, version: comment.version })),
      isComment,
      url,
    );
  }

  async remove(organizationId: string, comment: Versioned): Promise<void> {
    const url = tenantUrl(organizationId, `/comments/${comment.id}`);
    const params = new HttpParams().set('version', comment.version);
    await firstValueFrom(this.http.delete(url, { params }));
  }

  async candidates(
    organizationId: string,
    taskId: string,
    query: string,
  ): Promise<MentionCandidatePage> {
    const url = tenantUrl(organizationId, `/tasks/${taskId}/mentionable-users`);
    const params = new HttpParams().set('query', query);
    return checked(
      await firstValueFrom(this.http.get<unknown>(url, { params })),
      isMentionCandidatePage,
      url,
    );
  }
}
