import {TraceId, TraceSpanId} from "~/shared/id/types/id_types.open_source.js";
import {Schema} from "~/shared/schema/schema.open_source.js";
import {TracerEventFlatData} from "~/shared/tracer/helpers/build_tracer_event_flat_data.open_source.js";

export const TracerPropagationContextSchema = Schema.object({
    traceId: Schema.id<TraceId>(),
    parentId: Schema.id<TraceSpanId>(),
    data: Schema.unknown<TracerEventFlatData>(),
});
