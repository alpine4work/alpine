import {useEffect} from "react";
import {ShouldRevalidateFunction, useSearchParams} from "react-router-dom";
import {
    deserializePostIdForLoader,
    deserializeSpaceIdForLoader,
} from "~/app/helpers/deserialize_id_for_loader.js";
import {PostView, PostViewInitialScroll} from "~/client/web/forum/post_view.js";
import {useConstant} from "~/client/web/helpers/lifecycle/use_constant.js";
import {useInboxBannerOutletContainer} from "~/client/web/inbox/use_inbox_banner_outlet_container.js";
import {getInitialLoadMessageCount} from "~/client/web/messaging/get_initial_load_message_count.js";
import {createMetaFunction} from "~/client/web/remix/create_meta_function.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {useSearchAffinityViewEntityInteraction} from "~/client/web/search/use_search_affinity_view_entity_interaction.js";
import {contentStyles} from "~/client/web/styles/styles.js";
import {getPostAndInitialComments} from "~/server/forum/data/post_messaging.js";
import {getInboxEntry} from "~/server/notifications/data/get_inbox_entry.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {createDynamoGeneralRealtimeItemSchema} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {PostCommentModel, PostModel} from "~/shared/forum/post_model.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {isId} from "~/shared/id/id.js";
import {FileId} from "~/shared/id/types/id_types.js";
import {MessageContentPayloadParent} from "~/shared/messaging/message_schema.js";
import {InboxEntryModelSchema} from "~/shared/notifications/inbox_model.js";
import {Schema} from "~/shared/schema/schema.js";
import {
    ServerSynchronizationCheckpointSchema,
    generateServerSynchronizationCheckpoint,
} from "~/shared/web_socket/server_synchronization_checkpoint.js";

const LoaderSchema = Schema.object({
    checkpoint: ServerSynchronizationCheckpointSchema,
    post: createDynamoGeneralRealtimeItemSchema(PostModel.schema()),
    initialPostComments: Schema.array(PostCommentModel.schema()),
    initialOtherReferencedPostComments: Schema.array(PostCommentModel.schema()),
    inboxEntry: createDynamoGeneralRealtimeItemSchema(InboxEntryModelSchema).nullable(),
});

export async function loader({params, context: unauthenticatedContext, request}: LoaderArgs) {
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();

    const spaceId = deserializeSpaceIdForLoader(params.spaceId ?? null);
    const postId = deserializePostIdForLoader(params.postId ?? null);

    const commentLimit = getInitialLoadMessageCount(context.loader.getClientInfo());

    const url = new URL(request.url);

    // Generate checkpoint before we start loading data. So when we backfill we
    // include any realtime events that happened while loading data.
    const checkpoint = generateServerSynchronizationCheckpoint();

    const [{post, initialComments, initialOtherReferencedComments}, inboxEntry] =
        await runAllPromises([
            getPostAndInitialComments(context, {
                postId,
                commentLimit,
            }),
            url.searchParams.get("inbox") === "show"
                ? getInboxEntry(context, {
                      spaceId,
                      key: {type: "PostComments", postId},
                  })
                : null,
        ]);

    return jsonWithSchema(
        LoaderSchema,
        {
            checkpoint,
            post,
            initialPostComments: initialComments,
            initialOtherReferencedPostComments: initialOtherReferencedComments,
            inboxEntry,
        },
        {propagateEventData: {context: {channelId: post.model.channel.id}}},
    );
}

export const meta = createMetaFunction(LoaderSchema, ({data: {post}}) => [
    {
        // Account name in title won't update when account changes without reload
        // because we're using `initialData`.
        title: `Post by ${getAccountShortNameWithoutFullNameTooltip(
            post.model.author.initialData,
        )} in ${post.model.channel.name}`,
    },
]);

export const shouldRevalidate: ShouldRevalidateFunction = ({
    currentUrl: _currentUrl,
    nextUrl: _nextUrl,
    defaultShouldRevalidate,
}) => {
    const currentUrl = new URL(_currentUrl);
    const nextUrl = new URL(_nextUrl);

    currentUrl.searchParams.delete("scroll");
    nextUrl.searchParams.delete("scroll");

    currentUrl.searchParams.delete("parent");
    nextUrl.searchParams.delete("parent");

    // The client removes the `create` and `focus` search params. Don't revalidate
    // when the client does this.
    if (currentUrl.toString() === nextUrl.toString()) {
        return false;
    }

    return defaultShouldRevalidate;
};

export default function PostRoute() {
    const [searchParams, setSearchParams] = useSearchParams();
    const {checkpoint, post, initialPostComments, initialOtherReferencedPostComments, inboxEntry} =
        useLoaderDataWithSchema(LoaderSchema);

    const commentIndexString = searchParams.get("comment");
    const commentIndex = commentIndexString ? parseInt(commentIndexString, 10) : null;

    const initialScroll = useConstant((): PostViewInitialScroll | null => {
        if (commentIndex !== null) return {type: "Comment", commentIndex};

        const scrollString = searchParams.get("scroll");
        if (!scrollString) return null;

        // NOTE(calebmer): Prefix with `file-` since in the future I could see us
        // initially scrolling to headings or other things in the post.
        if (scrollString.startsWith("file-")) {
            const fileId = scrollString.slice(5);
            if (!isId<FileId>(fileId)) {
                throw new InvalidArgumentError("Expected `FileId`");
            }
            return {type: "File", fileId};
        }

        return null;
    });

    const initialParent = useConstant((): MessageContentPayloadParent | null => {
        const parentString = searchParams.get("parent");
        if (!parentString) return null;

        const [posString = "", contentVersionString = ""] = parentString.split("@", 2);
        const [startPosString = "", endPosString = ""] = posString.split("-", 2);

        const contentVersion = parseInt(contentVersionString, 10);
        const startPos = parseInt(startPosString, 10);
        const endPos = parseInt(endPosString, 10);

        if (isNaN(contentVersion) || isNaN(startPos) || isNaN(endPos)) return null;

        return {type: "PostRange", contentVersion, startPos, endPos};
    });

    useEffect(() => {
        if (searchParams.has("scroll") || searchParams.has("parent")) {
            const newSearchParams = new URLSearchParams(searchParams);
            newSearchParams.delete("scroll");
            newSearchParams.delete("parent");
            setSearchParams(newSearchParams, {replace: true});
        }
    }, [searchParams, setSearchParams]);

    // Spending time with a post accrues affinity points to the channel the post
    // was made in. If you're reading a post and its comments this probably means
    // the topic of the post (the channel) is relevant to you as well.
    //
    // We don't give posts themselves affinity points. That's because posts are
    // fairly short lived (a couple days). However, we give channels affinity
    // points so you could quickly jump to a channel if you're looking for a
    // certain post inside the channel.
    useSearchAffinityViewEntityInteraction(`Channel:${post.model.channel.id}`);

    const node = (
        <PostView
            // Remount when navigating to a different post.
            key={post.model.id}
            initialCheckpoint={checkpoint}
            initialPost={post}
            initialPostComments={initialPostComments}
            initialOtherReferencedPostComments={initialOtherReferencedPostComments}
            initialScroll={initialScroll}
            initialParent={initialParent}
        />
    );

    return useInboxBannerOutletContainer(
        {
            initialEntry: inboxEntry,
            maxWidth: contentStyles.contentMaxWidth,
        },
        node,
    );
}
