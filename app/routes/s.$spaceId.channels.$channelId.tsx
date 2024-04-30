import {useEffect, useState} from "react";
import {ShouldRevalidateFunction, useParams} from "react-router";
import {useSearchParams} from "react-router-dom";
import {Box} from "~/client/design/box.js";
import {ChannelCreatorView} from "~/client/forum/channel_creator_view.js";
import {ChannelView} from "~/client/forum/channel_view.js";
import {newChannelNamePlaceholder} from "~/client/forum/channel_view_name_editor.js";
import {postContentViewMinHeightWithClosedCommentSection} from "~/client/forum/post_content_view.js";
import {createMetaFunction} from "~/client/remix/create_meta_function.js";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {useSearchAffinityViewInteraction} from "~/client/search/use_search_affinity_view_interaction.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {getInitialVirtualizedScrollViewRenderedItemCount} from "~/client/virtualized/virtualized_scroll_view.js";
import {
    authorizeChannelAccess,
    createChannel,
    getChannel,
    getChannelPosts,
} from "~/server/forum/data/forum_table.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {
    DynamoGeneralRealtimeItem,
    createDynamoGeneralRealtimeIndexQuerySchema,
    createDynamoGeneralRealtimeItemSchema,
} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {FailedPreconditionError} from "~/shared/error/error.js";
import {ChannelModel} from "~/shared/forum/channel_model.js";
import {PostModel} from "~/shared/forum/post_model.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {isId} from "~/shared/id/id.js";
import {ChannelId, SpaceId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data.js";

const LoaderSchema = Schema.object({
    channelState: Schema.union({
        NotExists: Schema.object({
            type: Schema.value("NotExists"),
        }),
        Exists: Schema.object({
            type: Schema.value("Exists"),
            channel: createDynamoGeneralRealtimeItemSchema(ChannelModel.schema()),
            postsResult: createDynamoGeneralRealtimeIndexQuerySchema(PostModel.schema()),
        }),
    }),
});

export const meta = createMetaFunction(LoaderSchema, ({data: {channelState}}) => [
    {
        title:
            channelState.type === "Exists"
                ? channelState.channel.model.name
                : newChannelNamePlaceholder,
    },
]);

export async function loader({request, params, context: unauthenticatedContext}: LoaderArgs) {
    const context = await unauthenticatedContext.actor.authenticate();

    const url = new URL(request.url);
    const spaceId = Schema.id<SpaceId>().deserialize(params.spaceId ?? null);
    const channelId = Schema.id<ChannelId>().deserialize(params.channelId ?? null);

    const createSearchParam = url.searchParams.get("create");

    if (createSearchParam === "") {
        return jsonWithSchema(LoaderSchema, {channelState: {type: "NotExists"}});
    }

    let getDynamoGeneralRealtimeItem:
        | (() => Promise<DynamoGeneralRealtimeItem<ChannelModel>>)
        | undefined;

    if (createSearchParam !== null) {
        try {
            ({getDynamoGeneralRealtimeItem} = await createChannel(
                context.actor.authorizeSession(),
                {
                    spaceId,
                    channelId,
                    name: createSearchParam,
                },
            ));
        } catch (error) {
            if (!(error instanceof FailedPreconditionError)) {
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

    const [channel, postsResult] = await runAllPromises([
        getDynamoGeneralRealtimeItem
            ? getDynamoGeneralRealtimeItem()
            : getChannel(context, channelId),
        getChannelPosts(context, {
            channelId,
            limit: getInitialVirtualizedScrollViewRenderedItemCount(
                context.loader.getClientInfo(),
                postContentViewMinHeightWithClosedCommentSection,
            ),
            beforeCursor: null,
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
                channel,
                postsResult,
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

    // The client removes the `create` and `focus` search params. Don't revalidate
    // when the client does this.
    if (currentUrl.toString() === nextUrl.toString()) {
        return false;
    }

    return defaultShouldRevalidate;
};

export default function ChannelRoute({withMobileLayout = false}: {withMobileLayout?: boolean}) {
    const {channelState} = useLoaderDataWithSchema(LoaderSchema);
    const {channelId} = useParams();
    assert(channelId && isId<ChannelId>(channelId));
    const [searchParams, setSearchParams] = useSearchParams();

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

        if (searchParams.has("create") || searchParams.has("focus")) {
            const newSearchParams = new URLSearchParams(searchParams);
            newSearchParams.delete("create");
            newSearchParams.delete("focus");
            setSearchParams(newSearchParams, {replace: true});
        }
    }, [channelState.type, searchParams, setSearchParams]);

    useSearchAffinityViewInteraction(
        channelState.type === "Exists" ? `Channel:${channelState.channel.model.id}` : null,
    );

    return (
        <Box flexGrow="1" overflow="hidden" position="relative" zIndex="20" height="full">
            {channelState.type === "Exists" ? (
                <ChannelView
                    // Remount when navigating to a different channel.
                    key={channelId}
                    withMobileLayout={withMobileLayout}
                    initialChannel={channelState.channel}
                    initialPostsResult={channelState.postsResult}
                />
            ) : (
                <ChannelCreatorView
                    withMobileLayout={withMobileLayout}
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
