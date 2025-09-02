import {TraceId, TraceSpanId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";
import {TracerEventFlatData} from "~/shared/tracer/helpers/build_tracer_event_flat_data.js";

export const TracerPropagationContextSchema = Schema.object({
    traceId: Schema.id<TraceId>(),
    parentId: Schema.id<TraceSpanId>(),
    data: Schema.unknown<TracerEventFlatData>(),
});
