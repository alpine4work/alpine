import {expectTypeOf} from "expect-type";
import {
    TracerEventDataBase,
    TracerEventFullData,
} from "~/shared/tracer/types/tracer_event_data.open_source.js";

test("can cast event data into base type", () => {
    expectTypeOf<TracerEventFullData>().toMatchTypeOf<TracerEventDataBase>();
});
