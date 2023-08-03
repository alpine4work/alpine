import {OpensearchIndexUnsignedLongType} from "~/server/opensearch/opensearch_index_type.js";
import {HybridLogicalTime} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {
    deserializeHybridLogicalTime,
    serializeHybridLogicalTime,
} from "~/shared/schema/helpers/hybrid_logical_time_schema.js";

export const HybridLogicalTimeType =
    new OpensearchIndexUnsignedLongType().transform<HybridLogicalTime>({
        serialize: serializeHybridLogicalTime,
        deserialize: deserializeHybridLogicalTime,
    });

export const SortableHybridLogicalTimeType = new OpensearchIndexUnsignedLongType({
    isSortable: true,
}).transform<HybridLogicalTime>({
    serialize: serializeHybridLogicalTime,
    deserialize: deserializeHybridLogicalTime,
});
