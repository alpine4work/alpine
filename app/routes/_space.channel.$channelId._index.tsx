import {useEffect} from "react";
import {ShouldRevalidateFunction, useParams} from "react-router";
import {useSearchParams} from "react-router-dom";
import {createHeadMetaForChannel} from "~/app/helpers/create_head_meta.js";
import {
    deserializeChannelIdForLoader,
    deserializeSpaceIdForLoader,
} from "~/app/helpers/deserialize_id_for_loader.js";
import {loadWithSpaceAndSiteDiscovery} from "~/app/helpers/load_with_space_and_site_discovery.js";
import {Box} from "~/client/web/design/box.js";
import {ChannelView} from "~/client/web/forum/channel_view.js";
import {createMetaFunction} from "~/client/web/remix/create_meta_function.js";
import {getInitialAppRenderSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {useSearchAffinityViewEntityInteraction} from "~/client/web/search/use_search_affinity_view_entity_interaction.js";
import {
    channelViewAsidePostFileMaxCount,
    postContentViewMinHeightPx,
} from "~/client/web/styles/forum_shared_styles.js";
import {getInitialVirtualizedScrollViewRenderedItemCount} from "~/client/web/virtualized/get_initial_virtualized_scroll_view_rendered_item_count.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {isDynamoConditionCheckError} from "~/server/dynamo/core/is_dynamo_condition_check_error.js";
import {authorizeChannelAccess} from "~/server/forum/data/authorize_channel_access.js";
import {createChannel} from "~/server/forum/data/create_channel.js";
import {
    getChannelAndMetadata,
    getChannelAndMetadataPartitionKey,
} from "~/server/forum/data/get_channel_and_metadata.js";
import {getChannelContributorsKey} from "~/server/forum/data/get_channel_contributors.js";
import {
    getChannelPosts,
    getChannelPostsIndexName,
    getChannelPostsPartitionKey,
} from "~/server/forum/data/get_channel_posts.js";
import {isSubscribedToChannel} from "~/server/forum/data/is_subscribed_to_channel.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {isSearchFavoriteEntity} from "~/server/search/data/table/search_entity_actions.js";
import {authorizeSpaceAccessIfPossible} from "~/server/spaces/authorize_space_access.js";
import {getAccount} from "~/server/spaces/get_account.js";
import {getOpenGraphContent} from "~/shared/content/open_graph_content.js";
import {
    RynamoIndexQueryResult,
    RynamoItem,
    RynamoQueryResult,
    createRynamoIndexQuerySchema,
    createRynamoQuerySchema,
} from "~/shared/dynamo/rynamo_types.js";
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
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {generateId, isId} from "~/shared/id/id.js";
import {ChannelId, SpaceId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";
import {
    ServerSynchronizationCheckpoint,
    generateServerSynchronizationCheckpoint,
} from "~/shared/web_socket/server_synchronization_checkpoint.js";

const LoaderSchema = Schema.object({
    key: Schema.id(),
    channelResult: createRynamoQuerySchema(ChannelOrMetadataModelSchema),
    postsResult: createRynamoIndexQuerySchema(PostModel.schema()),
    isSubscribed: Schema.boolean,
    isFavorite: Schema.boolean,
});

function parseChannelCreateSearchParam(createSearchParam: string): {
    spaceId: SpaceId;
    channelName: string;
} {
    const spaceIdSeparatorIndex = createSearchParam.indexOf(" ");
    const spaceIdString =
        spaceIdSeparatorIndex === -1
            ? createSearchParam
            : createSearchParam.slice(0, spaceIdSeparatorIndex);

    return {
        spaceId: deserializeSpaceIdForLoader(spaceIdString),
        channelName:
            spaceIdSeparatorIndex === -1 ? "" : createSearchParam.slice(spaceIdSeparatorIndex + 1),
    };
}

export const meta = createMetaFunction(LoaderSchema, ({data: {channelResult}}) => {
    const channel = channelResult.items[0]?.model;
    assert(channel instanceof ChannelModel);

    let hasUrlGrant: boolean;
    switch (channel.accessPolicy.data.type) {
        case "Local":
            hasUrlGrant = channel.accessPolicy.data.urlGrant !== null;
            break;
        case "Site":
            hasUrlGrant = channel.accessPolicy.data.site.initialData.accessPolicy.urlGrant !== null;
            break;
        default:
            throw exhaustive(channel.accessPolicy.data);
    }

    return createHeadMetaForChannel({
        name: channel.name,
        openGraph: hasUrlGrant ? getOpenGraphContent(channel.name, channel.description) : null,
    });
});

export async function loader({request, params, context: unauthenticatedContext}: LoaderArgs) {
    const context = await unauthenticatedContext.actor.authenticate();

    const url = new URL(request.url);
    const channelId = deserializeChannelIdForLoader(params.channelId ?? null);

    const createSearchParam = url.searchParams.get("create");

    let created:
        | {
              spaceId: SpaceId;
              checkpoint: ServerSynchronizationCheckpoint;
              getRynamoItem: (context: ServerActionContext) => Promise<RynamoItem<ChannelModel>>;
          }
        | undefined;

    if (createSearchParam !== null) {
        const {spaceId, channelName} = parseChannelCreateSearchParam(createSearchParam);
        context.discovery.discoverSpaceId(spaceId, "CreateSearchParam");

        try {
            const checkpoint = generateServerSynchronizationCheckpoint();

            const {getRynamoItem} = await createChannel(context.actor.authorizeSession(), {
                spaceId,
                channelId,
                name: channelName,
            });

            created = {spaceId, checkpoint, getRynamoItem};
        } catch (error) {
            if (!isDynamoConditionCheckError(error)) {
                throw error;
            }

            // If there was an issue creating our channel, it might be because the channel
            // already exists. Attempt to authorize, if that fails we believe the issue was
            // actually with channel creation.
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

    const {
        data1: [channelResult, postsResult],
        data2: [spaceId, isSubscribed, isFavorite] = [null, false, false],
        siteLoaderData,
    } = await loadWithSpaceAndSiteDiscovery(context, {
        request,
        entityId: `Channel:${channelId}`,
        load1: async ({onSiteId}) => {
            return await runAllPromises([
                // If we're creating the channel then create an empty query since we should know
                // the channel model and initial channel contributors:
                created
                    ? (() => {
                          const sessionContext = context.actor.authorizeSession();

                          return runAllPromises([
                              created.getRynamoItem(sessionContext),
                              getAccount(
                                  sessionContext,
                                  created.spaceId,
                                  sessionContext.actor.getAccountId(),
                              ),
                          ]).then(
                              ([item, account]): RynamoQueryResult<ChannelOrMetadataModel> => ({
                                  checkpoint: created.checkpoint,
                                  partitionKey: getChannelAndMetadataPartitionKey(channelId),
                                  startItemKey: null,
                                  endItemKey: null,
                                  pageInfo: {
                                      type: "FromStart",
                                      afterItemKey: null,
                                      hasNextPage: false,
                                  },
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
                          );
                      })()
                    : getChannelAndMetadata(context, {
                          channelId,
                          // NOTE(calebmer): A small optimization could be to set this to 0 if we're
                          // rendering for mobile since mobile doesn't show recent files in a sidebar. Then
                          // the client would need to load new files if switching from mobile to desktop.
                          postFilesLimit: channelViewAsidePostFileMaxCount,
                          consistency,
                          onSiteId,
                      }),

                // If we're creating the channel then create an empty query since there are no
                // posts yet:
                created
                    ? cast<RynamoIndexQueryResult<PostModel>>({
                          checkpoint: created.checkpoint,
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
                              postContentViewMinHeightPx[
                                  getInitialAppRenderSpacingScale(clientInfo)
                              ],
                          ),
                          beforeCursor: null,
                      }),
            ]);
        },
        load2: async ({spaceId}) => {
            // If we just created the channel then we should know the actor is subscribed but
            // the channel is not a favorite:
            if (created) return [spaceId, true, false];

            return await runAllPromises([
                spaceId,
                authorizeSpaceAccessIfPossible(context, spaceId).then(result => {
                    if (!result.ok) return false;
                    return isSubscribedToChannel(context.actor.authorizeSession(), channelId, {
                        consistency,
                    });
                }),
                isSearchFavoriteEntity(context, {
                    spaceId,
                    entityId: `Channel:${channelId}`,
                }),
            ]);
        },
    });

    assert(spaceId);

    return jsonWithSchema(
        LoaderSchema,
        {
            key: generateId(),
            channelResult,
            postsResult,
            isSubscribed,
            isFavorite,
        },
        {siteLoaderData},
    );
}

export const shouldRevalidate: ShouldRevalidateFunction = ({
    currentUrl: _currentUrl,
    nextUrl: _nextUrl,
    defaultShouldRevalidate,
}) => {
    const currentUrl = new URL(_currentUrl);
    const nextUrl = new URL(_nextUrl);

    currentUrl.searchParams.delete("create");
    nextUrl.searchParams.delete("create");

    currentUrl.searchParams.delete("focus");
    nextUrl.searchParams.delete("focus");

    currentUrl.searchParams.delete("consistency");
    nextUrl.searchParams.delete("consistency");

    // The client removes the `create` and `focus` search params. Don't revalidate when
    // the client does this.
    if (currentUrl.toString() === nextUrl.toString()) {
        return false;
    }

    return defaultShouldRevalidate;
};

export default function ChannelRoute() {
    const {key} = useLoaderDataWithSchema(LoaderSchema);
    return (
        <ChannelRouteInner
            // We use a unique key to force a remount when we get new data from the server. We
            // added this specifically to support site-related access policy changes.
            //
            // When a channel's access policy is changed, the update will propagated to all
            // clients that have the channel loaded via their rynamo subscription.
            //
            // So if a Test Channel is added to a site while User A is viewing it, we call
            // `revalidate()` on User A's client. This reloads Test Channel's data, which will
            // also load the site data and store it at the space-level SiteContext. Once the
            // site data is added to the SiteContext, we can render the site chrome around the
            // channel.
            key={key}
        />
    );
}

function ChannelRouteInner() {
    const {channelResult, postsResult, isSubscribed, isFavorite} =
        useLoaderDataWithSchema(LoaderSchema);
    const {channelId} = useParams();
    assert(channelId && isId<ChannelId>(channelId));
    const [searchParams, setSearchParams] = useSearchParams();

    // Remove the `create` search param if we have a subscription to an existing
    // collection.
    const hasSearchParamToDelete = searchParams.has("create") || searchParams.has("consistency");
    useEffect(() => {
        if (hasSearchParamToDelete) {
            setSearchParams(
                oldSearchParams => {
                    const newSearchParams = new URLSearchParams(oldSearchParams);
                    newSearchParams.delete("create");
                    newSearchParams.delete("consistency");
                    return newSearchParams;
                },
                {replace: true},
            );
        }
    }, [hasSearchParamToDelete, setSearchParams]);

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
