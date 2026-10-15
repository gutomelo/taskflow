import baseConfig, { notificationsMustNotReachOtherContexts } from '../../../../eslint.config.mjs';

export default [...baseConfig, notificationsMustNotReachOtherContexts];
