import baseConfig from '../../../../eslint.config.mjs';

// A regra notificationsMustNotReachOtherContexts vale só na infraestrutura (único lugar com Prisma):
// aqui `task` é campo das visões de notificação.
export default [...baseConfig];
