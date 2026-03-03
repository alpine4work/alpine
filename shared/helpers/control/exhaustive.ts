import {InternalError} from "~/shared/error/error.js";
import {omitFromStackTrace} from "~/shared/helpers/control/omit_from_stack_trace.js";

/**
 * Exhaustiveness check for TypeScript. When you call this function TypeScript will
 * guarantee that the value you pass in should never exist according to the type
 * system.
 *
 * Returns an error so you can immediately throw if you want. However, we recommend
 * providing a reasonable default whenever possible. That way if we add a case in
 * the future the switch won't break.
 *
 * ```ts
 * switch (object.type) {
 *     case "red":
 *         return ...
 *     case "green":
 *         return ...
 *     case "blue":
 *         return ...
 *     default:
 *         throw exhaustive(object);
 * }
 * ```
 */
export const exhaustive = omitFromStackTrace((value: never): Error => {
    // If this is an object and we can infer a sentinel property then report the
    // sentinel property.
    //
    // We don't consider an inherently unexpected value of a sentinel property to be
    // sensitive data.
    if (typeof value === "object" && value !== null) {
        let sentinelProperty;
        for (const commonSentinelProperty of commonSentinelProperties) {
            if (value[commonSentinelProperty] !== undefined) {
                sentinelProperty = commonSentinelProperty;
                break;
            }
        }
        if (sentinelProperty) {
            const sentinelPropertyValue = JSON.stringify(value[sentinelProperty]);
            return new InternalError(
                `Unexpected object of ${sentinelProperty} ${sentinelPropertyValue} in exhaustive check`,
            );
        }
    }

    return new InternalError("Unexpected value in exhaustive check");
});

const commonSentinelProperties = ["type", "kind"];
