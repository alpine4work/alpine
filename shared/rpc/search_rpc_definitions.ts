import {AccessPolicySchema} from "~/shared/access/access_policy.js";
import {ChannelPreviewModel} from "~/shared/forum/channel_model.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {defineRpc} from "~/shared/rpc/internal/define_rpc.js";
import {OrderKeySchema} from "~/shared/schema/helpers/order_key_schema.js";
import {TimeZoneSchema} from "~/shared/schema/helpers/time_zone_schema.js";
import {Schema} from "~/shared/schema/schema.js";
import {SearchAffinityEntityInteractionSchema} from "~/shared/search/search_affinity_entity_interaction.js";
import {SearchAffinityEntityIdSchema} from "~/shared/search/search_entity_id.js";
import {
    SearchAffinityEntityResultModel,
    SearchEntityResultModel,
    SearchFavoriteEntityResultModel,
} from "~/shared/search/search_entity_result_model.js";
import {SearchOptionsSchema} from "~/shared/search/search_options.js";
import {TaskCollectionModelSearchResultSchema} from "~/shared/tasks/model/task_collection_model_search_result.js";

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
        results: Schema.array(SearchEntityResultModel.schema()),
    },
});

export const searchBySemantics = defineRpc({
    name: "searchBySemantics",
    input: {
        spaceId: Schema.id<SpaceId>(),
        queryText: Schema.string,
        limit: Schema.integer,
        timeZone: TimeZoneSchema,
        currentTime: Schema.date,
        debugOptions: SearchOptionsSchema.optional(),
    },
    output: {
        results: Schema.array(SearchEntityResultModel.schema()),
    },
});

export const searchByAffinity = defineRpc({
    name: "searchByAffinity",
    input: {
        spaceId: Schema.id<SpaceId>(),
    },
    output: {
        hasMoreFavoriteResults: Schema.boolean,
        favoriteResults: Schema.array(SearchFavoriteEntityResultModel.schema()),
        results: Schema.array(SearchAffinityEntityResultModel.schema()),
    },
});

export const markSearchAffinityEntityInteraction = defineRpc({
    name: "markSearchAffinityEntityInteraction",
    input: {
        spaceId: Schema.id<SpaceId>(),
        entityId: SearchAffinityEntityIdSchema,
        interaction: SearchAffinityEntityInteractionSchema,
    },
    output: {},
});

export const clearSearchEntityAffinity = defineRpc({
    name: "clearSearchEntityAffinity",
    input: {
        spaceId: Schema.id<SpaceId>(),
        entityId: SearchAffinityEntityIdSchema,
    },
    output: {},
});

export const searchChannelsByKeywords = defineRpc({
    name: "searchChannelsByKeywords",
    input: {
        spaceId: Schema.id<SpaceId>(),
        queryText: Schema.string,
        limit: Schema.integer,
    },
    output: {
        results: Schema.array(
            Schema.object({
                channel: ChannelPreviewModel.schema(),
                descriptionTextSnippet: Schema.string,
                accessPolicy: AccessPolicySchema,
            }),
        ),
    },
});

export const searchChannelsByAffinity = defineRpc({
    name: "searchChannelsByAffinity",
    input: {
        spaceId: Schema.id<SpaceId>(),
        limit: Schema.integer,
    },
    output: {
        results: Schema.array(
            Schema.object({
                channel: ChannelPreviewModel.schema(),
                descriptionTextSnippet: Schema.string,
                accessPolicy: AccessPolicySchema,
                origin: Schema.enum(["Account", "Space"]),
            }),
        ),
    },
});

export const searchTaskCollectionsByKeywords = defineRpc({
    name: "searchTaskCollectionsByKeywords",
    input: {
        spaceId: Schema.id<SpaceId>(),
        queryText: Schema.string,
        limit: Schema.integer,
    },
    output: {
        results: Schema.array(
            TaskCollectionModelSearchResultSchema.merge(
                Schema.object({
                    score: Schema.float,
                }),
            ),
        ),
    },
});

export const searchTaskCollectionsByAffinity = defineRpc({
    name: "searchTaskCollectionsByAffinity",
    input: {
        spaceId: Schema.id<SpaceId>(),
        limit: Schema.integer,
    },
    output: {
        results: Schema.array(
            TaskCollectionModelSearchResultSchema.merge(
                Schema.object({
                    origin: Schema.enum(["Account", "Space"]),
                }),
            ),
        ),
    },
});

export const favoriteSearchEntity = defineRpc({
    name: "favoriteSearchEntity",
    input: {
        spaceId: Schema.id<SpaceId>(),
        entityId: SearchAffinityEntityIdSchema,
    },
    output: {},
});

export const unfavoriteSearchEntity = defineRpc({
    name: "unfavoriteSearchEntity",
    input: {
        spaceId: Schema.id<SpaceId>(),
        entityId: SearchAffinityEntityIdSchema,
    },
    output: {},
});

export const moveSearchFavoriteEntity = defineRpc({
    name: "moveSearchFavoriteEntity",
    input: {
        spaceId: Schema.id<SpaceId>(),
        entityId: SearchAffinityEntityIdSchema,
        orderKey: OrderKeySchema,
    },
    output: {},
});
