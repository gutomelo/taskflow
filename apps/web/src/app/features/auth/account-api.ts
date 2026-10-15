import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type {
  ConfirmEmailVerificationRequest,
  ForgotPasswordRequest,
  ResetPasswordRequest,
} from '@taskflow/contracts';

export const ACCOUNT_API_PATHS = {
  confirmEmail: '/api/v1/auth/email-verification/confirm',
  forgotPassword: '/api/v1/auth/password/forgot',
  resetPassword: '/api/v1/auth/password/reset',
} as const;

/** Verificação de e-mail e recuperação de senha (spec 001). */
@Injectable({ providedIn: 'root' })
export class AccountApi {
  private readonly http = inject(HttpClient);

  /** Exige sessão da própria conta (BR-017); 204. */
  confirmEmail(request: ConfirmEmailVerificationRequest): Promise<void> {
    return firstValueFrom(this.http.post<void>(ACCOUNT_API_PATHS.confirmEmail, request));
  }

  /** 202 sempre: não revela se o e-mail tem conta (BR-014). */
  forgotPassword(request: ForgotPasswordRequest): Promise<void> {
    return firstValueFrom(this.http.post<void>(ACCOUNT_API_PATHS.forgotPassword, request));
  }

  /** 204; a API revoga todas as sessões e limpa os cookies deste navegador (BR-016). */
  resetPassword(request: ResetPasswordRequest): Promise<void> {
    return firstValueFrom(this.http.post<void>(ACCOUNT_API_PATHS.resetPassword, request));
  }
}
