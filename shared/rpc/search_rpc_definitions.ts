import {ChannelPreviewModel} from "~/shared/forum/channel_model.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {defineRpc} from "~/shared/rpc/internal/define_rpc.js";
import {TimeZoneSchema} from "~/shared/schema/helpers/time_zone_schema.js";
import {Schema} from "~/shared/schema/schema.js";
import {SearchAffinityIdSchema} from "~/shared/search/search_affinity_id.js";
import {SearchAffinityInteractionSchema} from "~/shared/search/search_affinity_interaction.js";
import {SearchOptionsSchema} from "~/shared/search/search_options.js";
import {SearchResultSchema} from "~/shared/search/search_result.js";
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
        results: Schema.array(SearchResultSchema),
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

export const markSearchAffinityInteraction = defineRpc({
    name: "markSearchAffinityInteraction",
    input: {
        spaceId: Schema.id<SpaceId>(),
        affinityId: SearchAffinityIdSchema,
        interaction: SearchAffinityInteractionSchema,
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
                origin: Schema.enum(["Account", "Space"]),
            }),
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
