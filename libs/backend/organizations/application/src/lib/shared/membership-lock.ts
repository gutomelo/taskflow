import type {
  Membership,
  MembershipRepository,
  OrganizationRepository,
} from '@taskflow/backend/organizations/domain';
import { OrganizationNotFoundError } from './organizations-errors';

/**
 * BR-019/BR-021 (design, "Decisão final sob lock"): trava a organização e relê a membership do
 * ator. Só pode ser chamada dentro de uma transação. O papel do middleware serviu apenas para a
 * negação rápida; a decisão usa o que está gravado agora.
 */
export async function lockOrganizationAndRereadActor(
  deps: {
    readonly organizations: OrganizationRepository;
    readonly memberships: MembershipRepository;
  },
  organizationId: string,
  actorUserId: string,
): Promise<Membership> {
  if (!(await deps.organizations.lockForMembershipChange(organizationId))) {
    throw new OrganizationNotFoundError();
  }
  const actor = await deps.memberships.find(organizationId, actorUserId);
  // Ator removido depois do middleware: mesma resposta de quem não é membro.
  if (!actor) throw new OrganizationNotFoundError();
  return actor;
}
