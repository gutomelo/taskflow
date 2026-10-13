export { DomainError } from './lib/errors/domain-error';
export type { Clock } from './lib/time/clock';
export type { IdGenerator } from './lib/identity/id-generator';
export { EmailAddress, InvalidEmailAddressError } from './lib/email/email-address';
export { VersionConflictError } from './lib/errors/version-conflict-error';
export { normalizeDisplayText } from './lib/text/display-text';
export {
  isOrganizationRole,
  ORGANIZATION_ROLES,
  type OrganizationRole,
} from './lib/organization/organization-role';
export {
  canOnProject,
  effectiveProjectRole,
  hasOrganizationPermission,
  isOrganizationPermission,
  isProjectPermission,
  isProjectRole,
  ORGANIZATION_PERMISSIONS,
  organizationGrant,
  organizationPermissions,
  PROJECT_PERMISSIONS,
  PROJECT_ROLES,
  projectGrant,
  type OrganizationGrant,
  type OrganizationPermission,
  type OrganizationSettings,
  type ProjectGrant,
  type ProjectPermission,
  type ProjectRole,
} from './lib/authorization/authorization';
