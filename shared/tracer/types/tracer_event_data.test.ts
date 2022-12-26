import {expectTypeOf} from "expect-type";
import {TracerEventDataBase, TracerEventFullData} from "~/shared/tracer/types/tracer_event_data";

test("can cast event data into base type", () => {
    expectTypeOf<TracerEventFullData>().toMatchTypeOf<TracerEventDataBase>();
});
