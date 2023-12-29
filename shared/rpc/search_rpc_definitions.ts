import {SpaceId} from "~/shared/id/types/id_types.js";
import {defineRpc} from "~/shared/rpc/internal/define_rpc.js";
import {Schema} from "~/shared/schema/schema.js";
import {SearchEntityAffinityIdSchema} from "~/shared/search/search_entity_affinity_id.js";
import {SearchEntityAffinityInteractionSchema} from "~/shared/search/search_entity_affinity_interaction.js";
import {SearchResultSchema} from "~/shared/search/search_result.js";

export const searchByKeywords = defineRpc({
    name: "searchByKeywords",
    input: {
        spaceId: Schema.id<SpaceId>(),
        queryText: Schema.string,
        limit: Schema.integer,
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

export const markSearchEntityAffinityInteraction = defineRpc({
    name: "markSearchEntityAffinityInteraction",
    input: {
        spaceId: Schema.id<SpaceId>(),
        entityId: SearchEntityAffinityIdSchema,
        interaction: SearchEntityAffinityInteractionSchema,
    },
    output: {},
});

export const getAffinitiveSearchEntities = defineRpc({
    name: "getAffinitiveSearchEntities",
    input: {
        spaceId: Schema.id<SpaceId>(),
        limit: Schema.integer,
    },
    output: {
        results: Schema.array(SearchResultSchema),
    },
});
