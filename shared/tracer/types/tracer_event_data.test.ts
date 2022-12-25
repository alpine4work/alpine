import {SchemaSerializedObjectValue} from "~/shared/schema/schema";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data";

test("can cast event data into serialized object value", () => {
    function cast(eventData: TracerEventData): SchemaSerializedObjectValue {
        return eventData;
    }

    // This test is only exercising TypeScript. We expect the above function to type
    // check. That means event data is JSON stringifiable without needing a schema.
    cast({});
});
