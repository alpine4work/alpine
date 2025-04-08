import {useEffect, useState} from "react";
import {ShouldRevalidateFunction, useParams} from "react-router";
import {useSearchParams} from "react-router-dom";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {ChannelDesktopCreator} from "~/client/forum/channel_desktop_creator.js";
import {ChannelMobileEditor} from "~/client/forum/channel_mobile_editor.js";
import {ChannelView} from "~/client/forum/channel_view.js";
import {newChannelNamePlaceholder} from "~/client/forum/new_channel_name_placeholder.js";
import {createMetaFunction} from "~/client/remix/create_meta_function.js";
import {NativeMobileBridge} from "~/client/remix/native_mobile_bridge.js";
import {usePlatform} from "~/client/remix/platform_context.js";
import {getInitialAppRenderSpacingScale} from "~/client/remix/spacing_scale_context.js";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {useSearchAffinityViewEntityInteraction} from "~/client/search/use_search_affinity_view_entity_interaction.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {
    channelViewAsidePostFileMaxCount,
    postContentViewMinHeightPx,
} from "~/client/styles/forum_shared_styles.js";
import {getInitialVirtualizedScrollViewRenderedItemCount} from "~/client/virtualized/get_initial_virtualized_scroll_view_rendered_item_count.js";
import {ServerContentActionContext} from "~/server/context/server_content_action_context.js";
import {isDynamoConditionCheckError} from "~/server/dynamo/core/is_dynamo_condition_check_error.js";
import {
    authorizeChannelAccess,
    createChannel,
    getChannelAndMetadata,
    getChannelAndMetadataPartitionKey,
    getChannelContributorsKey,
    getChannelPosts,
} from "~/server/forum/data/forum_table.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {isSearchFavoriteEntity} from "~/server/search/data/table/search_entity_table.js";
import {getAccount} from "~/server/spaces/spaces_table.js";
import {isContentEmpty} from "~/shared/content/is_content_empty.js";
import {
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
import {isId} from "~/shared/id/id.js";
import {ChannelId, SpaceId} from "~/shared/id/types/id_types.js";
import {emptyMessageContentWithReferences} from "~/shared/messaging/message_content_schema.js";
import {createChannel as createChannelRpc} from "~/shared/rpc/forum_rpc_definitions.js";
import {Schema} from "~/shared/schema/schema.js";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data.js";

const LoaderSchema = Schema.object({
    channelState: Schema.union({
        NotExists: Schema.object({
            type: Schema.value("NotExists"),
        }),
        Exists: Schema.object({
            type: Schema.value("Exists"),
            channelResult: createDynamoGeneralRealtimeQuerySchema(ChannelOrMetadataModelSchema),
            postsResult: createDynamoGeneralRealtimeIndexQuerySchema(PostModel.schema()),
            isFavorite: Schema.boolean,
        }),
    }),
});

export const meta = createMetaFunction(LoaderSchema, ({data: {channelState}}) => {
    return [
        {
            title:
                channelState.type === "Exists" &&
                channelState.channelResult.items[0]?.model instanceof ChannelModel
                    ? channelState.channelResult.items[0].model.name
                    : newChannelNamePlaceholder,
        },
    ];
});

export async function loader({request, params, context: unauthenticatedContext}: LoaderArgs) {
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();

    const url = new URL(request.url);
    const spaceId = Schema.id<SpaceId>().deserialize(params.spaceId ?? null);
    const channelId = Schema.id<ChannelId>().deserialize(params.channelId ?? null);

    const createSearchParam = url.searchParams.get("create");

    if (createSearchParam === "") {
        return jsonWithSchema(LoaderSchema, {channelState: {type: "NotExists"}});
    }

    let getDynamoGeneralRealtimeItem:
        | ((
              context: ServerContentActionContext,
          ) => Promise<DynamoGeneralRealtimeItem<ChannelModel>>)
        | undefined;

    if (createSearchParam !== null) {
        try {
            ({getDynamoGeneralRealtimeItem} = await createChannel(context, {
                spaceId,
                channelId,
                name: createSearchParam,
            }));
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
                await authorizeChannelAccess(context, channelId);
            } catch {
                throw error;
            }
        }
    }

    const clientInfo = context.loader.getClientInfo();

    const [channelResult, postsResult, isFavorite] = await runAllPromises([
        getDynamoGeneralRealtimeItem
            ? runAllPromises([
                  getDynamoGeneralRealtimeItem(context),
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
                  consistency:
                      url.searchParams.get("consistency") === "strong" ? "Strong" : undefined,
              }),
        getChannelPosts(context, {
            channelId,
            limit: getInitialVirtualizedScrollViewRenderedItemCount(
                clientInfo,
                postContentViewMinHeightPx[getInitialAppRenderSpacingScale(clientInfo)],
            ),
            beforeCursor: null,
        }),
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
            channelState: {
                type: "Exists",
                channelResult,
                postsResult,
                isFavorite,
            },
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
    const {channelState} = useLoaderDataWithSchema(LoaderSchema);
    const {channelId} = useParams();
    assert(channelId && isId<ChannelId>(channelId));
    const [searchParams, setSearchParams] = useSearchParams();

    const context = useAppContext();
    const platform = usePlatform();
    const navigate = useNavigate();
    const {space} = useSpaceContext();

    const [shouldInitiallyFocusChannelName] = useState(() => {
        const focusString = searchParams.get("focus");
        if (!focusString) return true;
        return focusString !== "none";
    });

    // Remove the `create` search param if we have a subscription to an
    // existing collection.
    useEffect(() => {
        if (channelState.type === "NotExists") return;

        if (
            searchParams.has("create") ||
            searchParams.has("focus") ||
            searchParams.has("consistency")
        ) {
            const newSearchParams = new URLSearchParams(searchParams);
            newSearchParams.delete("create");
            newSearchParams.delete("focus");
            newSearchParams.delete("consistency");
            setSearchParams(newSearchParams, {replace: true});
        }
    }, [channelState.type, searchParams, setSearchParams]);

    useSearchAffinityViewEntityInteraction(
        channelState.type === "Exists" &&
            channelState.channelResult.items[0]?.model instanceof ChannelModel
            ? `Channel:${channelState.channelResult.items[0].model.id}`
            : null,
    );

    return (
        <Box flexGrow="1" overflow="hidden" position="relative" zIndex="20" height="full">
            {channelState.type === "Exists" ? (
                <ChannelView
                    // Remount when navigating to a different channel.
                    key={channelId}
                    initialChannelResult={channelState.channelResult}
                    initialPostsResult={channelState.postsResult}
                    initialIsFavorite={channelState.isFavorite}
                />
            ) : platform === "mobile" ? (
                <ChannelMobileEditor
                    title="Create channel"
                    initiallyFocus="Name"
                    initialName=""
                    initialDescription={emptyMessageContentWithReferences}
                    onCloseWithAnimation={({hasSaved}) => {
                        if (hasSaved) return;
                        void navigate(-1);
                    }}
                    onSave={async ({name, description}) => {
                        if (isContentEmpty(description)) {
                            const newSearchParams = new URLSearchParams(searchParams);
                            newSearchParams.set("create", name);

                            await navigate(
                                `/s/${
                                    space.id
                                }/channels/${channelId}?${newSearchParams.toString()}`,
                                {
                                    replace: true,
                                    // In our native mobile app, we want to call
                                    // `NativeMobileBridge.navigation.replaceWithPushAnimation()` to run the native
                                    // push animation while replacing in the history stack.
                                    state: NativeMobileBridge
                                        ? {withPushAnimation: true}
                                        : undefined,
                                },
                            );
                        } else {
                            // It's slightly more efficient to create a channel with the `create` URL
                            // parameter because:
                            //
                            // 1. We don't need to read the channel back from DynamoDB in the loader since
                            //    we created the DynamoDB item in the loader.
                            //
                            // 2. We need to read the channel back from DynamoDB with strong read
                            //    consistency (which is more expensive than eventual consistency) or else
                            //    we risk telling the user the channel they just created doesn't exist.
                            //
                            // However, the `create` URL parameter doesn't support descriptions. We
                            // couldn't fit a long description into the URL. So if the user typed up a
                            // description we need to create the channel with an RPC then navigate to
                            // its URL.
                            await createChannelRpc(context, {
                                spaceId: space.id,
                                channelId,
                                name,
                                description,
                            });

                            await navigate(
                                `/s/${space.id}/channels/${channelId}?consistency=strong`,
                                {
                                    replace: true,
                                    // In our native mobile app, we want to call
                                    // `NativeMobileBridge.navigation.replaceWithPushAnimation()` to run the native
                                    // push animation while replacing in the history stack.
                                    state: NativeMobileBridge
                                        ? {withPushAnimation: true}
                                        : undefined,
                                },
                            );
                        }
                    }}
                />
            ) : (
                <ChannelDesktopCreator
                    channelId={channelId}
                    shouldInitiallyFocusChannelName={shouldInitiallyFocusChannelName}
                    createChannel={async name => {
                        const newSearchParams = new URLSearchParams(searchParams);
                        newSearchParams.set("create", name);

                        await navigate(
                            `/s/${space.id}/channels/${channelId}?${newSearchParams.toString()}`,
                            {replace: true},
                        );
                    }}
                />
            )}
        </Box>
    );
}
