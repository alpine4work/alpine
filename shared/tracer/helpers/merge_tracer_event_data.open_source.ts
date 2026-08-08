import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {
    TracerEventDataBase,
    TracerEventFullData,
} from "~/shared/tracer/types/tracer_event_data.open_source.js";

/**
 * Merges data from multiple tracer events together into one event.
 *
 * - Recursively merges any nested objects.
 * - Skips `undefined` values as if they were keys which don't exist.
 */
export function mergeTracerEventData(sources: Array<TracerEventFullData>): TracerEventFullData {
    const target: TracerEventFullData = {};
    for (const source of sources) mergeTracerEventDataInto(target, source);
    return target;
}

function mergeTracerEventDataInto(target: TracerEventDataBase, source: TracerEventDataBase) {
    for (const [key, sourceValue] of Object.entries(source)) {
        let targetValue = target[key];

        // Skip undefined values. Treat it as if the key doesn't exist.
        if (sourceValue === undefined) continue;

        // If both the source value and target value are plain objects then recursively
        // merge them together. Otherwise override the key with our source value.
        if (typeof sourceValue === "object") {
            if (targetValue === undefined) targetValue = target[key] = {};
            assert(typeof targetValue === "object");
            mergeTracerEventDataInto(targetValue, sourceValue);
        } else {
            target[key] = sourceValue;
        }
    }
}
