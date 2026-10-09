/** Eventos de integração de `organizations` (outbox → fila `emails` do worker). */
export const OrganizationsEventType = {
  /** `{ invitationId }`; o id do evento é o `delivery_event_id` do convite (um token vigente). */
  invitationRequested: 'organizations.invitation_requested',
} as const;

export type InvitationRequestedPayload = Readonly<{ invitationId: string }>;
