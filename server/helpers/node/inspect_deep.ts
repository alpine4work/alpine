import chalk from "chalk";
import {inspect} from "util";
import {assert} from "~/shared/helpers/control/assert.open_source.js";

// Make sure we don't use this function in production.
assert(process.env.NODE_ENV !== "production");

export function inspectDeep(value: unknown, depth: number = Infinity) {
    return inspect(value, {
        depth,
        colors: !!chalk.supportsColor,
    });
}
