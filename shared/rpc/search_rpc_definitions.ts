import {ChannelPreviewModel} from "~/shared/forum/channel_model.js";
import {
    AccountId,
    DatabaseTableId,
    SiteId,
    SpaceId,
} from "~/shared/id/types/id_types.open_source.js";
import {defineRpc} from "~/shared/rpc/internal/define_rpc.js";
import {OrderKeySchema} from "~/shared/schema/helpers/order_key_schema.js";
import {TimeZoneSchema} from "~/shared/schema/helpers/time_zone_schema.js";
import {Schema} from "~/shared/schema/schema.open_source.js";
import {SearchAffinityEntityInteractionSchema} from "~/shared/search/search_affinity_entity_interaction.js";
import {SearchAffinityEntityIdSchema} from "~/shared/search/search_entity_id.js";
import {SearchEntityModel} from "~/shared/search/search_entity_model.js";
import {
    SearchAffinityEntityResultModel,
    SearchEntityResultModel,
    SearchFavoriteEntityResultModel,
} from "~/shared/search/search_entity_result_model.js";
import {SearchOptionsSchema} from "~/shared/search/search_options.js";
import {TaskCollectionModelSearchResultSchema} from "~/shared/tasks/model/task_collection_model_search_result.js";

export const searchByKeywords = defineRpc({
    name: "searchByKeywords",
    isIdempotent: true,
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
    isIdempotent: true,
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
    isIdempotent: true,
    input: {
        spaceId: Schema.id<SpaceId>(),
    },
    output: {
        hasMoreFavoriteResults: Schema.boolean,
        favoriteResults: Schema.array(SearchFavoriteEntityResultModel.schema()),
        results: Schema.array(SearchAffinityEntityResultModel.schema()),
    },
});

export const searchDatabaseTablesByKeywords = defineRpc({
    name: "searchDatabaseTablesByKeywords",
    isIdempotent: true,
    input: {
        spaceId: Schema.id<SpaceId>(),
        queryText: Schema.string,
        limit: Schema.integer,
    },
    output: {
        results: Schema.array(
            Schema.object({
                tableId: Schema.id<DatabaseTableId>(),
                humanName: Schema.string,
                score: Schema.float,
            }),
        ),
    },
});

export const markSearchAffinityEntityInteraction = defineRpc({
    name: "markSearchAffinityEntityInteraction",
    // Will add affinity points twice if called twice.
    isIdempotent: false,
    input: {
        spaceId: Schema.id<SpaceId>(),
        entityId: SearchAffinityEntityIdSchema,
        interaction: SearchAffinityEntityInteractionSchema,
        // The id of the site the entity inherits its access policy from, or `null` if it
        // isn't in a site (or the entity itself is the site). When non-null, an additional
        // `searchAffinityEntitySiteCascadeRatio` (80% at time of writing) of the
        // interaction's points cascades to the site.
        siteId: Schema.id<SiteId>().nullable().default(null),
    },
    output: {},
});

export const clearSearchEntityAffinity = defineRpc({
    name: "clearSearchEntityAffinity",
    isIdempotent: true,
    input: {
        spaceId: Schema.id<SpaceId>(),
        entityId: SearchAffinityEntityIdSchema,
    },
    output: {},
});

export const searchMentionByKeywords = defineRpc({
    name: "searchMentionByKeywords",
    isIdempotent: true,
    input: {
        spaceId: Schema.id<SpaceId>(),
        queryText: Schema.string,
        limit: Schema.integer,
    },
    output: {
        results: Schema.array(
            Schema.object({
                score: Schema.float,
                model: SearchEntityModel.schema,
            }),
        ),
    },
});

export const searchChannelsByKeywords = defineRpc({
    name: "searchChannelsByKeywords",
    isIdempotent: true,
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
            }),
        ),
    },
});

export const searchChannelsByAffinity = defineRpc({
    name: "searchChannelsByAffinity",
    isIdempotent: true,
    input: {
        spaceId: Schema.id<SpaceId>(),
        limit: Schema.integer,
    },
    output: {
        results: Schema.array(
            Schema.object({
                channel: ChannelPreviewModel.schema(),
                descriptionTextSnippet: Schema.string,
                origin: Schema.enum(["Account", "Space"]),
            }),
        ),
    },
});

export const searchRoomChatsByKeywords = defineRpc({
    name: "searchRoomChatsByKeywords",
    isIdempotent: true,
    input: {
        spaceId: Schema.id<SpaceId>(),
        queryText: Schema.string,
        limit: Schema.integer,
        contributorIds: Schema.set(Schema.id<AccountId>()),
    },
    output: {
        results: Schema.array(SearchEntityModel.schema),
    },
});

export const searchTaskCollectionsByKeywords = defineRpc({
    name: "searchTaskCollectionsByKeywords",
    isIdempotent: true,
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
    isIdempotent: true,
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
    isIdempotent: true,
    input: {
        spaceId: Schema.id<SpaceId>(),
        entityId: SearchAffinityEntityIdSchema,
    },
    output: {},
});

export const unfavoriteSearchEntity = defineRpc({
    name: "unfavoriteSearchEntity",
    isIdempotent: true,
    input: {
        spaceId: Schema.id<SpaceId>(),
        entityId: SearchAffinityEntityIdSchema,
    },
    output: {},
});

export const moveSearchFavoriteEntity = defineRpc({
    name: "moveSearchFavoriteEntity",
    isIdempotent: true,
    input: {
        spaceId: Schema.id<SpaceId>(),
        entityId: SearchAffinityEntityIdSchema,
        orderKey: OrderKeySchema,
    },
    output: {},
});
