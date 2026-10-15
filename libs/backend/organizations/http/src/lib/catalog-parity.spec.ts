import { ORGANIZATION_PERMISSIONS, ORGANIZATION_ROLES } from '@taskflow/backend/shared/kernel';
import { organizationPermissionSchema, organizationRoleSchema } from '@taskflow/contracts';

// O kernel não importa `libs/contracts` (tags Nx): o catálogo é espelhado e esta é a única camada
// que enxerga os dois (ADR 0013). Divergência quebra aqui, não em produção.
describe('authorization catalog parity (kernel × contracts)', () => {
  it('keeps the organization permissions identical', () => {
    expect([...organizationPermissionSchema.options].sort()).toEqual(
      [...ORGANIZATION_PERMISSIONS].sort(),
    );
  });

  it('keeps the organization roles identical', () => {
    expect([...organizationRoleSchema.options].sort()).toEqual([...ORGANIZATION_ROLES].sort());
  });
});
