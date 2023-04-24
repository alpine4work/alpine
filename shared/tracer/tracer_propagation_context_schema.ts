import {TraceId, TraceSpanId} from "~/shared/id/types/id_types";
import {Schema} from "~/shared/schema/schema";
import {TracerEventFlatData} from "~/shared/tracer/helpers/build_tracer_event_flat_data";

export const TracerPropagationContextSchema = Schema.object({
    traceId: Schema.id<TraceId>(),
    parentId: Schema.id<TraceSpanId>(),
    data: Schema.unknown as Schema<any> as Schema<TracerEventFlatData>,
});
