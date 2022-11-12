/* eslint-disable no-console */

import chalk from "chalk";

// TODO(calebmer): Something smarter than this, probably OpenTelemetry?
export const logger = {
    debug: (...args: Array<unknown>) => console.log(chalk.gray("[debug]"), ...args),
    info: (...args: Array<unknown>) => console.info(chalk.blue("[info]"), ...args),
    warn: (...args: Array<unknown>) => console.warn(chalk.yellow("[warn]"), ...args),
    error: (...args: Array<unknown>) => console.error(chalk.red("[error]"), ...args),
} as const;
