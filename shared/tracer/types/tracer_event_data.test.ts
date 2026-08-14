import {expectTypeOf} from "expect-type";
import {TracerEventFullData} from "~/shared/tracer/types/tracer_event_data.js";
import {TracerEventDataBase} from "~/shared/tracer/types/tracer_event_data_types.open_source.js";

test("can cast event data into base type", () => {
    expectTypeOf<TracerEventFullData>().toMatchTypeOf<TracerEventDataBase>();
});
