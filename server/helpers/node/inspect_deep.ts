import {inspect} from "util";
import {assert} from "~/shared/helpers/control/assert.js";

// Make sure we don't use this function in production.
assert(process.env.NODE_ENV !== "production");

export function inspectDeep(value: unknown, depth: number = Infinity) {
    return inspect(value, {
        depth,
        // Detect if color is enabled using the same check process as Node.js.
        // https://github.com/nodejs/node/blob/0bbe5d34e74e8b4cc161a4777b161bfb917cf1e5/lib/internal/util/colors.js#L18-L25
        colors:
            (process.env.FORCE_COLOR !== undefined || process.stdout.isTTY) &&
            (typeof process.stdout.getColorDepth === "function"
                ? process.stdout.getColorDepth() > 2
                : true),
    });
}
