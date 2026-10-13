import { PROJECT_PERMISSIONS, PROJECT_ROLES } from '@taskflow/backend/shared/kernel';
import { STATUS_CATEGORIES } from '@taskflow/backend/projects/domain';
import {
  projectPermissionSchema,
  projectRoleSchema,
  statusCategorySchema,
} from '@taskflow/contracts';

// O kernel e o domínio não importam `libs/contracts`: os catálogos são espelhados e esta é a
// camada que enxerga os dois (ADR 0013). Divergência quebra aqui, não em produção.
describe('projects catalog parity (kernel/domain × contracts)', () => {
  it('keeps the project permissions identical', () => {
    expect([...projectPermissionSchema.options].sort()).toEqual([...PROJECT_PERMISSIONS].sort());
  });

  it('keeps the project roles identical', () => {
    expect([...projectRoleSchema.options].sort()).toEqual([...PROJECT_ROLES].sort());
  });

  it('keeps the status categories identical', () => {
    expect([...statusCategorySchema.options].sort()).toEqual([...STATUS_CATEGORIES].sort());
  });
});
