import chalk from "chalk";

// TODO: something smarter than this
export const logger = {
    debug: (...args: unknown[]) => console.log(chalk.gray("[debug]"), ...args),
    info: (...args: unknown[]) => console.info(chalk.blue("[info]"), ...args),
    warn: (...args: unknown[]) => console.warn(chalk.yellow("[warn]"), ...args),
    error: (...args: unknown[]) => console.error(chalk.red("[error]"), ...args),
} as const;
