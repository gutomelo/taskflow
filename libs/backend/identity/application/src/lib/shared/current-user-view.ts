import type { User } from '@taskflow/backend/identity/domain';

/** Visão pública do usuário (contrato `CurrentUser`): nunca inclui hash, versão ou datas internas. */
export type CurrentUserView = Readonly<{
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
}>;

export function toCurrentUserView(user: User): CurrentUserView {
  return {
    id: user.id,
    name: user.name.value,
    email: user.email.value,
    emailVerified: user.isEmailVerified,
  };
}
