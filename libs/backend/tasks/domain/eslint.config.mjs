import baseConfig, { tasksMustNotReachOtherContexts } from '../../../../eslint.config.mjs';

export default [...baseConfig, tasksMustNotReachOtherContexts];
