import {LinkedList} from "~/shared/helpers/immutable/linked_list.open_source.js";
import {convertCamelCaseToSnakeCase} from "~/shared/helpers/string/convert_camel_case_to_snake_case.open_source.js";
import {TracerEventDataBase} from "~/shared/tracer/types/tracer_event_data_types.open_source.js";

export type TracerEventFlatData = {
    [key: string]: string | number | boolean;
};

/**
 * Takes a nested `TracerEventData` object and builds the flat, snake case keyed,
 * object we transport over the wire and report to our observability provider.
 *
 * We use a flat, snake case, event format since that's the most universal format
 * for this kind of event based instrumentation. It's used across programming
 * languages, observability vendors, and (perhaps most importantly) [OpenTelemetry
 * semantic conventions][1].
 *
 * [1]:
 *     https://github.com/open-telemetry/semantic-conventions/blob/main/docs/general/trace.md
 */
export function buildTracerEventFlatData(
    nestedDataList: LinkedList<TracerEventDataBase>,
    propagatedFlatData: TracerEventFlatData | null,
): TracerEventFlatData {
    const data: TracerEventFlatData = {};

    const add = (
        snakeCaseKeyPath: string,
        value: string | number | boolean | undefined | TracerEventDataBase,
    ) => {
        if (value === undefined) {
            // Ignore undefined values...
        } else if (typeof value !== "object") {
            // Values at the top of the linked list override values at the bottom. If we've
            // already set a value at this property, then don't set it again.
            if (data[snakeCaseKeyPath] === undefined) {
                data[snakeCaseKeyPath] = value;
            }
        } else {
            for (const [camelCaseKey, keyValue] of Object.entries(value)) {
                const snakeCaseKey = convertCamelCaseToSnakeCase(camelCaseKey);
                add(`${snakeCaseKeyPath}.${snakeCaseKey}`, keyValue);
            }
        }
    };

    while (nestedDataList !== null) {
        const nestedData = nestedDataList.value;

        for (const [camelCaseKey, keyValue] of Object.entries(nestedData)) {
            const snakeCaseKey = convertCamelCaseToSnakeCase(camelCaseKey);
            add(snakeCaseKey, keyValue);
        }

        nestedDataList = nestedDataList.next;
    }

    if (propagatedFlatData !== null) {
        for (const [key, value] of Object.entries(propagatedFlatData)) {
            // Propagated event data is overridden by event data defined in this process. So
            // make sure the key doesn't have a value already before copying over propagated
            // flat data.
            if (data[key] === undefined) {
                data[key] = value;
            }
        }
    }

    return data;
}
