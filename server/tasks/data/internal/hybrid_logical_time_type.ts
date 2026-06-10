import {OpensearchIndexLongType} from "~/server/opensearch/opensearch_index_type.js";
import {HybridLogicalTime} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {
    deserializeHybridLogicalTime,
    serializeHybridLogicalTime,
} from "~/shared/schema/helpers/hybrid_logical_time_schema.js";

// Ideally we'd use the `unsigned_long` type here but OpenSearch errors when you
// use `unsigned_long` as an index sort field. It's fine with `long` though. This
// means we only have 47 bits for time (since `HybridLogicalTime` already cuts us
// down to 48). In ~4000 years we'll run out of int64 space. Hopefully by then we
// can use unsigned longs as index sort fields in OpenSearch.
export const HybridLogicalTimeType = new OpensearchIndexLongType().transform<HybridLogicalTime>({
    serialize: serializeHybridLogicalTime,
    deserialize: deserializeHybridLogicalTime,
});

// Ideally we'd use the `unsigned_long` type here but OpenSearch errors when you
// use `unsigned_long` as an index sort field. It's fine with `long` though. This
// means we only have 47 bits for time (since `HybridLogicalTime` already cuts us
// down to 48). In ~4000 years we'll run out of int64 space. Hopefully by then we
// can use unsigned longs as index sort fields in OpenSearch.
export const SortableHybridLogicalTimeType = new OpensearchIndexLongType({
    isSortable: true,
    isUsableInScripts: true,
}).transform<HybridLogicalTime>({
    serialize: serializeHybridLogicalTime,
    deserialize: deserializeHybridLogicalTime,
});
