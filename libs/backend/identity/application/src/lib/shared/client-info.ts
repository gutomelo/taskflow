import { isIPv4, isIPv6 } from 'node:net';
import type { SessionClient } from '@taskflow/backend/identity/domain';

/** Dados brutos do cliente vindos do transporte; minimizados antes de persistir. */
export type ClientInfo = Readonly<{
  ipAddress: string | null;
  userAgent: string | null;
}>;

const USER_AGENT_MAX_LENGTH = 256;

/**
 * Minimização de dados (LGPD): guarda apenas o prefixo da rede (IPv4 /24, IPv6 /64) e o
 * user agent truncado — suficiente para "sessões ativas" e para a tolerância de BR-012.
 */
export function toSessionClient({ ipAddress, userAgent }: ClientInfo): SessionClient {
  return {
    ipPrefix: ipAddress ? ipPrefix(ipAddress) : null,
    userAgent: userAgent ? userAgent.slice(0, USER_AGENT_MAX_LENGTH) : null,
  };
}

function ipPrefix(ipAddress: string): string | null {
  const address = ipAddress.startsWith('::ffff:') ? ipAddress.slice('::ffff:'.length) : ipAddress;
  if (isIPv4(address)) {
    return `${address.split('.').slice(0, 3).join('.')}.0/24`;
  }
  if (isIPv6(address)) {
    const [head = '', tail = ''] = address.split('::');
    const headGroups = head ? head.split(':') : [];
    const tailGroups = tail ? tail.split(':') : [];
    const groups = [
      ...headGroups,
      ...Array<string>(Math.max(8 - headGroups.length - tailGroups.length, 0)).fill('0'),
      ...tailGroups,
    ];
    return `${groups
      .slice(0, 4)
      .map((group) => group.padStart(4, '0').toLowerCase())
      .join(':')}::/64`;
  }
  return null;
}
