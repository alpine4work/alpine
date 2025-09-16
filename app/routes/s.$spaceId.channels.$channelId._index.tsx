import {useEffect} from "react";
import {ShouldRevalidateFunction, useParams} from "react-router";
import {useSearchParams} from "react-router-dom";
import {
    deserializeChannelIdForLoader,
    deserializeSpaceIdForLoader,
} from "~/app/helpers/deserialize_id_for_loader.js";
import {Box} from "~/client/design/box.js";
import {ChannelView} from "~/client/forum/channel_view.js";
import {createMetaFunction} from "~/client/remix/create_meta_function.js";
import {getInitialAppRenderSpacingScale} from "~/client/remix/spacing_scale_context.js";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema.js";
import {useSearchAffinityViewEntityInteraction} from "~/client/search/use_search_affinity_view_entity_interaction.js";
import {
    channelViewAsidePostFileMaxCount,
    postContentViewMinHeightPx,
} from "~/client/styles/forum_shared_styles.js";
import {getInitialVirtualizedScrollViewRenderedItemCount} from "~/client/virtualized/get_initial_virtualized_scroll_view_rendered_item_count.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {isDynamoConditionCheckError} from "~/server/dynamo/core/is_dynamo_condition_check_error.js";
import {
    authorizeChannelAccess,
    createChannel,
    getChannelAndMetadata,
    getChannelAndMetadataPartitionKey,
    getChannelContributorsKey,
    getChannelPosts,
    getChannelPostsIndexName,
    getChannelPostsPartitionKey,
    isSubscribedToChannel,
} from "~/server/forum/data/forum_actions.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {isSearchFavoriteEntity} from "~/server/search/data/table/search_entity_table.js";
import {getAccount} from "~/server/spaces/spaces_table.js";
import {
    DynamoGeneralRealtimeIndexQueryResult,
    DynamoGeneralRealtimeItem,
    DynamoGeneralRealtimeQueryResult,
    createDynamoGeneralRealtimeIndexQuerySchema,
    createDynamoGeneralRealtimeQuerySchema,
} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {
    ChannelContributorsModel,
    ChannelModel,
    ChannelOrMetadataModel,
    ChannelOrMetadataModelSchema,
} from "~/shared/forum/channel_model.js";
import {PostModel} from "~/shared/forum/post_model.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {isId} from "~/shared/id/id.js";
import {ChannelId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data.js";

const LoaderSchema = Schema.object({
    channelResult: createDynamoGeneralRealtimeQuerySchema(ChannelOrMetadataModelSchema),
    postsResult: createDynamoGeneralRealtimeIndexQuerySchema(PostModel.schema()),
    isSubscribed: Schema.boolean,
    isFavorite: Schema.boolean,
});

export const meta = createMetaFunction(LoaderSchema, ({data: {channelResult}}) => {
    const channel = channelResult.items[0]?.model;
    assert(channel instanceof ChannelModel);
    return [{title: channel.name}];
});

export async function loader({request, params, context: unauthenticatedContext}: LoaderArgs) {
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();

    const url = new URL(request.url);
    const spaceId = deserializeSpaceIdForLoader(params.spaceId ?? null);
    const channelId = deserializeChannelIdForLoader(params.channelId ?? null);

    const createSearchParam = url.searchParams.get("create");

    let created:
        | {
              getDynamoGeneralRealtimeItem: (
                  context: ServerActionContext,
              ) => Promise<DynamoGeneralRealtimeItem<ChannelModel>>;
          }
        | undefined;

    if (createSearchParam !== null) {
        try {
            const {getDynamoGeneralRealtimeItem} = await createChannel(context, {
                spaceId,
                channelId,
                name: createSearchParam,
            });

            created = {getDynamoGeneralRealtimeItem};
        } catch (error) {
            if (!isDynamoConditionCheckError(error)) {
                throw error;
            }

            // If there was an issue creating our channel, it might be because the
            // channel already exists. Attempt to authorize, if that fails we
            // believe the issue was actually with channel creation.
            //
            // This check makes this `GET` endpoint idempotent. You can hit the endpoint
            // multiple times and if our channel is already created we'll noop.
            try {
                await authorizeChannelAccess(context, channelId, "View", {consistency: "Strong"});
            } catch {
                throw error;
            }
        }
    }

    const clientInfo = context.loader.getClientInfo();

    const consistency: DynamoReadConsistency | undefined =
        url.searchParams.get("consistency") === "strong" ? "Strong" : undefined;

    const [channelResult, postsResult, isSubscribed, isFavorite] = await runAllPromises([
        // If we're creating the channel then create an empty query since we should
        // know the channel model and initial channel contributors:
        created
            ? runAllPromises([
                  created.getDynamoGeneralRealtimeItem(context),
                  getAccount(context, spaceId, context.actor.getAccountId()),
              ]).then(
                  ([item, account]): DynamoGeneralRealtimeQueryResult<ChannelOrMetadataModel> => ({
                      readTime: new Date(),
                      partitionKey: getChannelAndMetadataPartitionKey(channelId),
                      startItemKey: null,
                      endItemKey: null,
                      pageInfo: {type: "FromStart", afterItemKey: null, hasNextPage: false},
                      items: [
                          item,
                          {
                              key: getChannelContributorsKey(channelId),
                              version: 0,
                              model: new ChannelContributorsModel({
                                  contributorCount: 1,
                                  topContributors: [account],
                              }),
                          },
                      ],
                  }),
              )
            : getChannelAndMetadata(context, {
                  channelId,
                  // NOTE(calebmer): A small optimization could be to set this to 0 if we're
                  // rendering for mobile since mobile doesn't show recent files in a sidebar.
                  // Then the client would need to load new files if switching from mobile to
                  // desktop.
                  postFilesLimit: channelViewAsidePostFileMaxCount,
                  consistency,
              }),

        // If we're creating the channel then create an empty query since there are no
        // posts yet:
        created
            ? cast<DynamoGeneralRealtimeIndexQueryResult<PostModel>>({
                  readTime: new Date(),
                  indexName: getChannelPostsIndexName(),
                  partitionKey: getChannelPostsPartitionKey(channelId),
                  startCursorBound: null,
                  endCursorBound: null,
                  pageInfo: {type: "FromStart", afterCursor: null, hasNextPage: false},
                  items: [],
              })
            : getChannelPosts(context, {
                  channelId,
                  limit: getInitialVirtualizedScrollViewRenderedItemCount(
                      clientInfo,
                      postContentViewMinHeightPx[getInitialAppRenderSpacingScale(clientInfo)],
                  ),
                  beforeCursor: null,
              }),

        // If we just created the channel then we should know the actor is subscribed:
        created ? true : isSubscribedToChannel(context, channelId, {consistency}),

        isSearchFavoriteEntity(context, {
            spaceId,
            entityId: `Channel:${channelId}`,
        }),
    ]);

    const propagateEventData: TracerEventData = {
        context: {channelId},
    };

    return jsonWithSchema(
        LoaderSchema,
        {
            channelResult,
            postsResult,
            isSubscribed,
            isFavorite,
        },
        {propagateEventData},
    );
}

export const shouldRevalidate: ShouldRevalidateFunction = ({
    currentUrl: _currentUrl,
    nextUrl: _nextUrl,
    defaultShouldRevalidate,
}) => {
    const currentUrl = new URL(_currentUrl);
    const nextUrl = new URL(_nextUrl);

    // When switching from `/s/:spaceId/channels/:channelId?create` to
    // `/s/:spaceId/channels/:channelId?create=:channelName` we need
    // to revalidate since the server will actually create the channel.
    if (currentUrl.searchParams.get("create") !== "") currentUrl.searchParams.delete("create");
    if (nextUrl.searchParams.get("create") !== "") nextUrl.searchParams.delete("create");

    currentUrl.searchParams.delete("focus");
    nextUrl.searchParams.delete("focus");

    currentUrl.searchParams.delete("consistency");
    nextUrl.searchParams.delete("consistency");

    // The client removes the `create` and `focus` search params. Don't revalidate
    // when the client does this.
    if (currentUrl.toString() === nextUrl.toString()) {
        return false;
    }

    return defaultShouldRevalidate;
};

export default function ChannelRoute() {
    const {channelResult, postsResult, isSubscribed, isFavorite} =
        useLoaderDataWithSchema(LoaderSchema);
    const {channelId} = useParams();
    assert(channelId && isId<ChannelId>(channelId));
    const [searchParams, setSearchParams] = useSearchParams();

    // Remove the `create` search param if we have a subscription to an
    // existing collection.
    useEffect(() => {
        if (searchParams.has("create") || searchParams.has("consistency")) {
            const newSearchParams = new URLSearchParams(searchParams);
            newSearchParams.delete("create");
            newSearchParams.delete("consistency");
            setSearchParams(newSearchParams, {replace: true});
        }
    }, [searchParams, setSearchParams]);

    useSearchAffinityViewEntityInteraction(
        channelResult.items[0]?.model instanceof ChannelModel
            ? `Channel:${channelResult.items[0].model.id}`
            : null,
    );

    return (
        <Box flexGrow="1" overflow="hidden" position="relative" zIndex="20" height="full">
            <ChannelView
                // Remount when navigating to a different channel.
                key={channelId}
                initialChannelResult={channelResult}
                initialPostsResult={postsResult}
                initialIsSubscribed={isSubscribed}
                initialIsFavorite={isFavorite}
            />
        </Box>
    );
}
