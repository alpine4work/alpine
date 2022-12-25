import {isPlainObject} from "~/shared/helpers/object/is_plain_object";
import {SchemaSerializedValue} from "~/shared/schema/schema";
import {TracerEventFullData} from "~/shared/tracer/types/tracer_event_data";

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

function mergeTracerEventDataInto(
    target: {[key: string]: SchemaSerializedValue | undefined},
    source: {[key: string]: SchemaSerializedValue | undefined},
) {
    for (const [key, sourceValue] of Object.entries(source)) {
        const targetValue = target[key];

        // Skip undefined values. Treat it as if the key doesn't exist.
        if (sourceValue === undefined) continue;

        // If both the source value and target value are plain objects then recursively
        // merge them together. Otherwise override the key with our source value.
        if (isPlainObject(targetValue) && isPlainObject(sourceValue)) {
            mergeTracerEventDataInto(targetValue, sourceValue);
        } else {
            target[key] = sourceValue;
        }
    }
}
