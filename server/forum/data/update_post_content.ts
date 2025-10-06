import {applyMentionCountByAccountIdDifferenceFromContentUpdate} from "~/server/content/get_mentioned_account_ids_in_content.js";
import {
    ServerActionContext,
    ServerSessionActionContext,
} from "~/server/context/server_action_context.js";
import {DynamoGeneralRealtimeTableSchema} from "~/server/dynamo/core/general_realtime/dynamo_general_realtime_table_schema.js";
import {authorizeChannelAccess} from "~/server/forum/data/authorize_channel_access.js";
import {
    ChannelPostFilesItem,
    ForumRealtimeTable,
    PostAttributesItem,
} from "~/server/forum/data/internal/forum_realtime_table.js";
import {getPostContentFileIds} from "~/server/forum/data/internal/get_post_content_file_ids.js";
import {
    DynamoGeneralRealtimeEvent,
    DynamoGeneralRealtimePutItemEvent,
} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {getPostSearchEntityTitleContentSnippet} from "~/shared/forum/create_post_search_entity_title.js";
import {PostContent} from "~/shared/forum/post_content_schema.js";
import {PostModel} from "~/shared/forum/post_model.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {PostId} from "~/shared/id/types/id_types.js";

/**
 * Update the contents of a post if you are the post's author.
 */
export function updatePostContent(
    context: ServerSessionActionContext,
    {postId, content}: {postId: PostId; content: PostContent},
): Promise<{
    contentUpdatedTime: Date;
    getDynamoGeneralRealtimeEventTransaction: (context: ServerActionContext) => Promise<{
        readTime: Date;
        eventTransaction: ReadonlyArray<DynamoGeneralRealtimeEvent<PostModel>>;
    }>;
}> {
    return context.dynamo.retryTransaction(async context => {
        const readTime = new Date();

        const oldPostItem = await ForumRealtimeTable.getItem(context, {
            partitionType: "Post",
            sortRangeType: "Attributes",
            postId,
        });

        await authorizeChannelAccess(context, oldPostItem.channelId, "Edit");

        if (oldPostItem.authorId !== context.actor.getAccountId())
            throw new PermissionDeniedError("Can only update posts you authored");

        const contentUpdatedTime = new Date(
            oldPostItem.contentUpdatedTime
                ? Math.max(oldPostItem.contentUpdatedTime.getTime() + 1, Date.now())
                : Date.now(),
        );

        const newPostItem: PostAttributesItem = {
            ...oldPostItem,
            content,
            contentUpdatedTime,
            commentsSummary: {
                ...oldPostItem.commentsSummary,
                mentionCountByAccountId: applyMentionCountByAccountIdDifferenceFromContentUpdate(
                    oldPostItem.commentsSummary.mentionCountByAccountId,
                    oldPostItem.content,
                    content,
                ),
            },
        };

        const oldFileIds = getPostContentFileIds(oldPostItem.content);
        const newFileIds = getPostContentFileIds(newPostItem.content);

        let result: {
            getEvent: (
                context: ServerActionContext,
            ) => Promise<DynamoGeneralRealtimePutItemEvent<PostModel>>;
        };

        if (isDeepEqual(oldFileIds, newFileIds)) {
            result = await ForumRealtimeTable.directlyUpdateItem(context, newPostItem);
        } else if (oldFileIds.size === 0) {
            const channelPostFilesDeletedItem = await ForumRealtimeTable.getDeletedItemIfExists(
                context,
                {
                    partitionType: "Channel",
                    sortRangeType: "PostFiles",
                    channelId: newPostItem.channelId,
                    postCreatedTime: newPostItem.createdTime,
                    postId,
                },
            );

            const {transactionEntry, getEvent} =
                ForumRealtimeTable.transactionDirectlyUpdateItemWithEvent(newPostItem);

            result = {getEvent};

            const channelPostFilesItem: ChannelPostFilesItem = {
                partitionType: "Channel",
                sortRangeType: "PostFiles",
                channelId: newPostItem.channelId,
                postCreatedTime: newPostItem.createdTime,
                postId: newPostItem.postId,
                spaceId: newPostItem.spaceId,
                fileIds: newFileIds,
            };

            await DynamoGeneralRealtimeTableSchema.executeTransaction(context, [
                transactionEntry,
                channelPostFilesDeletedItem
                    ? ForumRealtimeTable.transactionUndeleteItem(
                          channelPostFilesDeletedItem,
                          channelPostFilesItem,
                      )
                    : ForumRealtimeTable.transactionDangerouslyCreateItemWithoutExistenceConditionCheck(
                          channelPostFilesItem,
                      ),
            ]);
        } else {
            const channelPostFilesItem = await ForumRealtimeTable.getItem(context, {
                partitionType: "Channel",
                sortRangeType: "PostFiles",
                channelId: newPostItem.channelId,
                postCreatedTime: newPostItem.createdTime,
                postId,
            });

            const {transactionEntry, getEvent} =
                ForumRealtimeTable.transactionDirectlyUpdateItemWithEvent(newPostItem);

            result = {getEvent};

            await DynamoGeneralRealtimeTableSchema.executeTransaction(context, [
                transactionEntry,
                newFileIds.size === 0
                    ? ForumRealtimeTable.transactionDeleteItem(channelPostFilesItem)
                    : ForumRealtimeTable.transactionDirectlyUpdateItem({
                          ...channelPostFilesItem,
                          fileIds: newFileIds,
                      }),
            ]);
        }

        const updatedTraits: Array<"Title"> = [];

        // If the start of the post changed, then we need to update anyone who
        // mentioned the post.
        if (
            !getPostSearchEntityTitleContentSnippet(oldPostItem.content).eq(
                getPostSearchEntityTitleContentSnippet(newPostItem.content),
            )
        ) {
            updatedTraits.push("Title");
        }

        context.jobs.send({
            type: "IndexSearchEntity",
            spaceId: newPostItem.spaceId,
            update: {
                type: "Post",
                postId,
                updatedTraits: {type: "Some", traits: updatedTraits},
            },
        });

        return {
            contentUpdatedTime,
            getDynamoGeneralRealtimeEventTransaction: async context => ({
                readTime,
                eventTransaction: [await result.getEvent(context)],
            }),
        };
    });
}
