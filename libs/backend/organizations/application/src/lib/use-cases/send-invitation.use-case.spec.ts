import type { OrganizationRole, TenantRequestContext } from '@taskflow/backend/shared/application';
import type { EmailMessage } from '@taskflow/backend/shared/application';
import {
  INVITATION_TTL_MS,
  Membership,
  Organization,
  OrganizationName,
  OrganizationSlug,
} from '@taskflow/backend/organizations/domain';
import {
  createOrganizationsTestbed,
  type OrganizationsTestbed,
} from '../../testing/organizations-fakes';
import { InviteMemberUseCase } from './invite-member.use-case';
import { ResendInvitationUseCase } from './resend-invitation.use-case';
import { RevokeInvitationUseCase } from './revoke-invitation.use-case';
import { SendInvitationUseCase } from './send-invitation.use-case';

async function seed(bed: OrganizationsTestbed) {
  const now = bed.clock.now();
  const organization = Organization.create({
    id: bed.idGenerator.generate(),
    name: OrganizationName.create('Acme “Ltda”'),
    slug: OrganizationSlug.create('acme'),
    now,
  });
  await bed.organizations.add(organization);
  bed.users.add({ id: 'ana', name: 'Ana Souza', email: 'ana@exemplo.com', emailVerified: true });
  await bed.memberships.add(
    Membership.create({
      id: 'm-ana',
      organizationId: organization.id,
      userId: 'ana',
      role: 'owner',
      now,
    }),
  );
  return organization.id;
}

function as(organizationId: string, role: OrganizationRole = 'owner'): TenantRequestContext {
  return {
    requestId: 'r',
    actor: { userId: 'ana', sessionId: 's' },
    tenant: { organizationId, organizationRole: role },
  };
}

/** O evento que a API pôs na outbox para este convite (último envio). */
function lastEventFor(bed: OrganizationsTestbed, invitationId: string) {
  const event = bed.outbox.events
    .filter((candidate) => candidate.payload['invitationId'] === invitationId)
    .at(-1);
  if (!event) throw new Error('no event queued');
  return { eventId: event.id, invitationId };
}

function tokenFrom(message: EmailMessage | undefined): string {
  if (!message) throw new Error('no e-mail sent');
  const data: unknown = JSON.parse(message.text);
  const link = typeof data === 'object' && data !== null && 'link' in data ? String(data.link) : '';
  return decodeURIComponent(link.split('#token=')[1] ?? '');
}

describe('SendInvitationUseCase (worker, BR-020, ADR 0011)', () => {
  it('CA-04: issues the current token and e-mails the invited address with a fragment link', async () => {
    const bed = createOrganizationsTestbed();
    const acme = await seed(bed);
    const { invitation } = await new InviteMemberUseCase(bed).execute(as(acme), {
      email: 'bia@exemplo.com',
      role: 'admin',
    });

    const outcome = await new SendInvitationUseCase(bed).execute(lastEventFor(bed, invitation.id));

    expect(outcome).toEqual({ status: 'sent' });
    const [message] = bed.emailSender.sent;
    expect(message?.to.value).toBe('bia@exemplo.com');
    expect(JSON.parse(message?.text ?? '{}')).toMatchObject({
      organizationName: 'Acme “Ltda”',
      inviterName: 'Ana Souza',
      role: 'admin',
      validForDays: INVITATION_TTL_MS / 86_400_000,
      link: expect.stringMatching(/^https:\/\/app\.taskflow\.test\/invitations\/accept#token=/),
    });
    const token = tokenFrom(message);
    expect(
      (await bed.invitations.findUsableByTokenHash(bed.tokens.hash(token), bed.clock.now()))?.id,
    ).toBe(invitation.id);
  });

  it('CA-06: an old event delivered out of order is discarded and the current link survives', async () => {
    const bed = createOrganizationsTestbed();
    const acme = await seed(bed);
    const { invitation } = await new InviteMemberUseCase(bed).execute(as(acme), {
      email: 'bia@exemplo.com',
      role: 'member',
    });
    const first = lastEventFor(bed, invitation.id);
    bed.rateLimiter.consumed.clear();
    await new ResendInvitationUseCase(bed).execute(as(acme), invitation.id);
    const second = lastEventFor(bed, invitation.id);
    const send = new SendInvitationUseCase(bed);

    expect(await send.execute(second)).toEqual({ status: 'sent' });
    expect(await send.execute(first)).toEqual({ status: 'discarded', reason: 'superseded' });

    expect(bed.emailSender.sent).toHaveLength(1);
    const current = tokenFrom(bed.emailSender.sent[0]);
    expect(
      await bed.invitations.findUsableByTokenHash(bed.tokens.hash(current), bed.clock.now()),
    ).not.toBeNull();
  });

  it('a retry of the same event replaces the token: only the last attempt link works', async () => {
    const bed = createOrganizationsTestbed();
    const acme = await seed(bed);
    const { invitation } = await new InviteMemberUseCase(bed).execute(as(acme), {
      email: 'bia@exemplo.com',
      role: 'member',
    });
    const event = lastEventFor(bed, invitation.id);
    const send = new SendInvitationUseCase(bed);
    bed.emailSender.failNext();

    await expect(send.execute(event)).rejects.toThrow('SMTP unavailable');
    await send.execute(event);

    const [failed, delivered] = bed.emailSender.attempted;
    const now = bed.clock.now();
    expect(
      await bed.invitations.findUsableByTokenHash(bed.tokens.hash(tokenFrom(failed)), now),
    ).toBeNull();
    expect(
      await bed.invitations.findUsableByTokenHash(bed.tokens.hash(tokenFrom(delivered)), now),
    ).not.toBeNull();
  });

  it('discards revoked, expired and unknown invitations without sending', async () => {
    const bed = createOrganizationsTestbed();
    const acme = await seed(bed);
    const invite = new InviteMemberUseCase(bed);
    const revoked = (await invite.execute(as(acme), { email: 'r@exemplo.com', role: 'member' }))
      .invitation;
    await new RevokeInvitationUseCase(bed).execute(as(acme), revoked.id);
    const expired = (await invite.execute(as(acme), { email: 'e@exemplo.com', role: 'member' }))
      .invitation;
    const send = new SendInvitationUseCase(bed);

    // Revogado e ainda no prazo: descartado por estar encerrado, não por expiração.
    expect(await send.execute(lastEventFor(bed, revoked.id))).toEqual({
      status: 'discarded',
      reason: 'invitation_closed',
    });
    bed.clock.advance(INVITATION_TTL_MS);
    expect(await send.execute(lastEventFor(bed, expired.id))).toEqual({
      status: 'discarded',
      reason: 'invitation_closed',
    });
    expect(await send.execute({ eventId: 'x', invitationId: 'missing' })).toEqual({
      status: 'discarded',
      reason: 'invitation_not_found',
    });
    expect(bed.emailSender.attempted).toEqual([]);
  });

  it('writes the phrase without a name when the inviter account is gone', async () => {
    const bed = createOrganizationsTestbed();
    const acme = await seed(bed);
    const { invitation } = await new InviteMemberUseCase(bed).execute(as(acme), {
      email: 'bia@exemplo.com',
      role: 'viewer',
    });
    bed.users.accounts.delete('ana');

    await new SendInvitationUseCase(bed).execute(lastEventFor(bed, invitation.id));

    expect(JSON.parse(bed.emailSender.sent[0]?.text ?? '{}')).toMatchObject({ inviterName: null });
  });
});
