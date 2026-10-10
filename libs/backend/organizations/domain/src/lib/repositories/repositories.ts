import type { EmailAddress } from '@taskflow/backend/shared/kernel';
import type { Invitation } from '../invitation/invitation';
import type { Membership } from '../membership/membership';
import type { Organization } from '../organization/organization';

/** Página por cursor (opaco). */
export type Page<T> = Readonly<{ items: ReadonlyArray<T>; nextCursor: string | null }>;
export type PageRequest = Readonly<{ limit: number; cursor: string | null }>;

export interface OrganizationRepository {
  /** Lança `SlugTakenError` se o slug já existir (inclusive por corrida). */
  add(organization: Organization): Promise<void>;
  findById(organizationId: string): Promise<Organization | null>;
  /**
   * Lote para "minhas organizações": só com ids vindos das memberships do próprio usuário.
   * Ids inexistentes são ignorados; a ordem não é garantida.
   */
  findByIds(organizationIds: ReadonlyArray<string>): Promise<ReadonlyArray<Organization>>;
  /** BR-008: `VersionConflictError` se a versão lida estiver desatualizada. */
  save(organization: Organization): Promise<void>;
  /**
   * Trava a organização até o fim da transação (`FOR NO KEY UPDATE`, sem alterar `version`):
   * serializa mutações de membership e convites (BR-019/BR-021). `false` se não existir.
   */
  lockForMembershipChange(organizationId: string): Promise<boolean>;
}

/** Todas as operações recebem `organizationId` e o aplicam em leitura **e** escrita. */
export interface MembershipRepository {
  /** Lança `AlreadyAMemberError` se o usuário já for membro (inclusive por corrida). */
  add(membership: Membership): Promise<void>;
  find(organizationId: string, userId: string): Promise<Membership | null>;
  listPage(organizationId: string, page: PageRequest): Promise<Page<Membership>>;
  /** Consulta global do próprio usuário ("minhas organizações"). */
  listForUser(userId: string): Promise<ReadonlyArray<Membership>>;
  countForUser(userId: string): Promise<number>;
  countOwnedBy(userId: string): Promise<number>;
  countOwners(organizationId: string): Promise<number>;
  /** BR-008: `VersionConflictError` se desatualizada. */
  save(membership: Membership): Promise<void>;
  /** BR-008: `VersionConflictError` se a versão não bater. */
  remove(organizationId: string, userId: string, version: number): Promise<void>;
}

export interface InvitationRepository {
  add(invitation: Invitation): Promise<void>;
  /** Grava reenvio, reconvite e revogação (filtrado por `organizationId`). */
  save(invitation: Invitation): Promise<void>;
  findById(organizationId: string, invitationId: string): Promise<Invitation | null>;
  /**
   * Só para o worker (processo do sistema, sem tenant): o id vem de um evento da própria outbox.
   * Nunca exposto a requisições de usuário.
   */
  findForDelivery(invitationId: string): Promise<Invitation | null>;
  findOpenByEmail(organizationId: string, email: EmailAddress): Promise<Invitation | null>;
  listOpenPage(organizationId: string, page: PageRequest): Promise<Page<Invitation>>;
  /** Revoga os convites abertos criados por um membro removido ou rebaixado. Retorna quantos. */
  revokeOpenInvitedBy(organizationId: string, userId: string, now: Date): Promise<number>;
  /** Convite aberto e não expirado dono do token (lookup e checagens antes do aceite). */
  findUsableByTokenHash(tokenHash: string, now: Date): Promise<Invitation | null>;
  /**
   * Consumo atômico condicionado ao e-mail da conta (BR-020). `null` se inexistente, de outro
   * e-mail, expirado, revogado ou já aceito — sem distinção.
   */
  consume(input: {
    readonly tokenHash: string;
    readonly email: EmailAddress;
    readonly acceptedByUserId: string;
    readonly now: Date;
  }): Promise<Invitation | null>;
  /**
   * Worker: grava o hash do token só se o convite segue aberto e não expirado e o evento ainda é
   * o último envio (`delivery_event_id`). `false` ⇒ descartar o envio.
   */
  issueToken(input: {
    readonly invitationId: string;
    readonly deliveryEventId: string;
    readonly tokenHash: string;
    readonly now: Date;
  }): Promise<boolean>;
}
