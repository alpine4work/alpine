import {useSearchParams} from "react-router-dom";
import {PostView} from "~/client/forum/post_view.js";
import {InboxBannerOutletContainer} from "~/client/inbox/inbox_banner_outlet_container.js";
import {getInitialLoadMessageCount} from "~/client/messaging/messaging_view.js";
import {createMetaFunction} from "~/client/remix/create_meta_function.js";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema.js";
import {metaTitlePostfix} from "~/client/remix/use_update_meta_title.js";
import {useSearchAffinityViewInteraction} from "~/client/search/use_search_affinity_view_interaction.js";
import {contentStyles} from "~/client/styles/styles.js";
import {getPostAndInitialComments} from "~/server/forum/data/forum_table.js";
import {getInboxEntry} from "~/server/notifications/data/notifications_table.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {createDynamoGeneralRealtimeItemSchema} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {PostCommentModel, PostModel} from "~/shared/forum/post_model.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {PostId, SpaceId} from "~/shared/id/types/id_types.js";
import {InboxEntryModelSchema} from "~/shared/notifications/inbox_model.js";
import {Schema} from "~/shared/schema/schema.js";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data.js";

const LoaderSchema = Schema.object({
    post: createDynamoGeneralRealtimeItemSchema(PostModel.schema()),
    initialPostComments: Schema.array(PostCommentModel.schema()),
    initialOtherReferencedPostComments: Schema.array(PostCommentModel.schema()),
    inboxEntry: createDynamoGeneralRealtimeItemSchema(InboxEntryModelSchema).nullable(),
});

export async function loader({params, context: unauthenticatedContext, request}: LoaderArgs) {
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();

    const spaceId = Schema.id<SpaceId>().deserialize(params.spaceId ?? null);
    const postId = Schema.id<PostId>().deserialize(params.postId ?? null);

    const commentLimit = getInitialLoadMessageCount(context.loader.getClientInfo());

    const url = new URL(request.url);

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

    const propagateEventData: TracerEventData = {
        context: {
            postId,
            channelId: post.model.channel.id,
        },
    };

    return jsonWithSchema(
        LoaderSchema,
        {
            post,
            initialPostComments: initialComments,
            initialOtherReferencedPostComments: initialOtherReferencedComments,
            inboxEntry,
        },
        {propagateEventData},
    );
}

export const meta = createMetaFunction(LoaderSchema, ({data: {post}}) => [
    {
        // Account name in title won't update when account changes without reload
        // because we're using `initialData`.
        title: `Post by ${getAccountShortNameWithoutFullNameTooltip(
            post.model.author.initialData,
        )} in ${post.model.channel.name}${metaTitlePostfix}`,
    },
]);

export default function PostRoute({withMobileLayout = false}: {withMobileLayout?: boolean}) {
    const [searchParams] = useSearchParams();
    const {post, initialPostComments, initialOtherReferencedPostComments, inboxEntry} =
        useLoaderDataWithSchema(LoaderSchema);

    const postCommentIndexString = searchParams.get("comment");
    const postCommentIndex = postCommentIndexString ? parseInt(postCommentIndexString, 10) : null;

    // Spending time with a post accrues affinity points to the channel the post
    // was made in. If you're reading a post and its comments this probably means
    // the topic of the post (the channel) is relevant to you as well.
    //
    // We don't give posts themselves affinity points. That's because posts are
    // fairly short lived (a couple days). However, we give channels affinity
    // points so you could quickly jump to a channel if you're looking for a
    // certain post inside the channel.
    useSearchAffinityViewInteraction(`Channel:${post.model.channel.id}`);

    const node = (
        <PostView
            // Remount when navigating to a different post.
            key={post.model.id}
            initialPost={post}
            initialPostComments={initialPostComments}
            initialOtherReferencedPostComments={initialOtherReferencedPostComments}
            initialScrollToPostCommentIndex={postCommentIndex}
            withMobileLayout={withMobileLayout}
        />
    );

    if (!inboxEntry) {
        return node;
    } else {
        return (
            <InboxBannerOutletContainer
                initialEntry={inboxEntry}
                withMobileLayout={withMobileLayout}
                maxWidth={contentStyles.contentMaxWidth}
                borderBottom="grey-10"
            >
                {node}
            </InboxBannerOutletContainer>
        );
    }
}
