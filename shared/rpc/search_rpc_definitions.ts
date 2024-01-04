import {SpaceId} from "~/shared/id/types/id_types.js";
import {defineRpc} from "~/shared/rpc/internal/define_rpc.js";
import {TimeZoneSchema} from "~/shared/schema/helpers/time_zone_schema.js";
import {Schema} from "~/shared/schema/schema.js";
import {SearchEntityAffinityIdSchema} from "~/shared/search/search_entity_affinity_id.js";
import {SearchEntityAffinityInteractionSchema} from "~/shared/search/search_entity_affinity_interaction.js";
import {SearchOptionsSchema} from "~/shared/search/search_options.js";
import {SearchResultSchema} from "~/shared/search/search_result.js";

export const searchByKeywords = defineRpc({
    name: "searchByKeywords",
    input: {
        spaceId: Schema.id<SpaceId>(),
        queryText: Schema.string,
        limit: Schema.integer,
        timeZone: TimeZoneSchema,
        currentTime: Schema.date,
        debugOptions: SearchOptionsSchema.optional(),
    },
    output: {
        results: Schema.array(SearchResultSchema),
    },
});

export const searchBySemantics = defineRpc({
    name: "searchBySemantics",
    input: {
        spaceId: Schema.id<SpaceId>(),
        queryText: Schema.string,
        limit: Schema.integer,
    },
    output: {
        results: Schema.array(SearchResultSchema),
    },
});

export const searchByAffinity = defineRpc({
    name: "searchByAffinity",
    input: {
        spaceId: Schema.id<SpaceId>(),
        limit: Schema.integer,
    },
    output: {
        results: Schema.array(SearchResultSchema),
    },
});

export const markSearchEntityAffinityInteraction = defineRpc({
    name: "markSearchEntityAffinityInteraction",
    input: {
        spaceId: Schema.id<SpaceId>(),
        entityId: SearchEntityAffinityIdSchema,
        interaction: SearchEntityAffinityInteractionSchema,
    },
    output: {},
});
