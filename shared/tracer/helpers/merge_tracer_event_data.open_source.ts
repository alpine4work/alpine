import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {isObject} from "~/shared/helpers/object/is_object.open_source.js";

/**
 * Merges data from multiple tracer events together into one event.
 *
 * - Recursively merges any nested objects.
 * - Skips `undefined` values as if they were keys which don't exist.
 */
export function mergeTracerEventData<Source>(sources: Array<Source>): Source;
export function mergeTracerEventData(sources: Array<unknown>): unknown {
    const target: {[key: string]: unknown} = {};
    for (const source of sources) {
        if (isObject(source)) mergeTracerEventDataInto(target, source);
    }
    return target;
}

function mergeTracerEventDataInto(
    target: {[key: string]: unknown},
    source: {[key: string]: unknown},
) {
    for (const [key, sourceValue] of Object.entries(source)) {
        let targetValue = target[key];

        // Skip undefined values. Treat it as if the key doesn't exist.
        if (sourceValue === undefined) continue;

        // If both the source value and target value are plain objects then recursively
        // merge them together. Otherwise override the key with our source value.
        if (isObject(sourceValue)) {
            if (targetValue === undefined) targetValue = target[key] = {};
            assert(isObject(targetValue));
            mergeTracerEventDataInto(targetValue, sourceValue);
        } else {
            target[key] = sourceValue;
        }
    }
}
