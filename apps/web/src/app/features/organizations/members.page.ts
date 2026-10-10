import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActiveOrganizationStore } from '../../core/organizations';
import { InvitationsPanel } from './invitations-panel';
import { MembersList } from './members-list';
import { invitationsMessages, membersMessages } from './organizations.messages';

/** `/o/:slug/members` (RF-06…RF-12): membros para todos; convites só para owner/admin. */
@Component({
  selector: 'tf-members-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [InvitationsPanel, MembersList],
  template: `
    <div class="mx-auto flex max-w-4xl flex-col gap-10 px-4 py-10">
      <section aria-labelledby="members-title">
        <h1 id="members-title" class="mb-4 text-2xl font-semibold tracking-tight">
          {{ members.title }}
        </h1>
        <tf-members-list />
      </section>
      @if (active.canManage()) {
        <section aria-labelledby="invitations-title">
          <h2 id="invitations-title" class="text-xl font-semibold tracking-tight">
            {{ invitations.title }}
          </h2>
          <tf-invitations-panel />
        </section>
      }
    </div>
  `,
})
export class MembersPage {
  protected readonly active = inject(ActiveOrganizationStore);
  protected readonly members = membersMessages;
  protected readonly invitations = invitationsMessages;
}
