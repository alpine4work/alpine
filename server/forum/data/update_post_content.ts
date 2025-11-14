import {Mapping, Step, StepResult} from "prosemirror-transform";
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
} from "~/server/forum/data/internal/forum_realtime_table.js";
import {getPostContentFileIds} from "~/server/forum/data/internal/get_post_content_file_ids.js";
import {
    DynamoGeneralRealtimeEvent,
    DynamoGeneralRealtimePutItemEvent,
} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {FailedPreconditionError, PermissionDeniedError} from "~/shared/error/error.js";
import {getPostSearchEntityTitleContentSnippet} from "~/shared/forum/create_post_search_entity_title.js";
import {isPostContent} from "~/shared/forum/post_content_schema.js";
import {PostModel} from "~/shared/forum/post_model.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {PostId} from "~/shared/id/types/id_types.js";

/**
 * Update the contents of a post if you are the post's author.
 */
export function updatePostContent(
    context: ServerSessionActionContext,
    {
        postId,
        contentVersion,
        steps,
    }: {
        postId: PostId;
        contentVersion: number;
        steps: ReadonlyArray<Step>;
    },
): Promise<{
    contentUpdatedTime: Date;
    getDynamoGeneralRealtimeEventTransaction: (
        context: ServerActionContext,
    ) => Promise<ReadonlyArray<DynamoGeneralRealtimeEvent<PostModel>>>;
}> {
    return context.dynamo.retryTransaction(async context => {
        const oldPostItem = await ForumRealtimeTable.getItem(context, {
            partitionType: "Post",
            sortRangeType: "Attributes",
            postId,
        });

        await authorizeChannelAccess(context, oldPostItem.channelId, "Edit");

        if (oldPostItem.authorId !== context.actor.getAccountId())
            throw new PermissionDeniedError("Can only update posts you authored");

        if (contentVersion !== (oldPostItem.contentUpdate?.mappings.length ?? 0))
            throw new FailedPreconditionError("Can’t update post with mismatched content version");

        let content = oldPostItem.content;
        const mapping = new Mapping();

        for (const step of steps) {
            let stepResult: StepResult;
            try {
                stepResult = step.apply(content);
            } catch (error) {
                throw FailedPreconditionError.from(error);
            }
            if (!stepResult.doc) {
                throw new FailedPreconditionError(
                    `Couldn’t apply step to content: ${stepResult.failed!}`,
                );
            }

            assert(isPostContent(stepResult.doc));
            content = stepResult.doc;
            mapping.appendMap(step.getMap());
        }

        const contentUpdatedTime = new Date(
            oldPostItem.contentUpdate
                ? Math.max(oldPostItem.contentUpdate.time.getTime() + 1, Date.now())
                : Date.now(),
        );

        const newPostItem = oldPostItem.update({
            content,
            contentUpdate: {
                time: contentUpdatedTime,
                mappings: [...(oldPostItem.contentUpdate?.mappings ?? emptyArray), mapping],
            },
            commentsSummary: {
                ...oldPostItem.commentsSummary,
                mentionCountByAccountId: applyMentionCountByAccountIdDifferenceFromContentUpdate(
                    oldPostItem.commentsSummary.mentionCountByAccountId,
                    oldPostItem.content,
                    content,
                ),
            },
        });

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
                    : ForumRealtimeTable.transactionDirectlyUpdateItem(
                          channelPostFilesItem.update({fileIds: newFileIds}),
                      ),
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
            getDynamoGeneralRealtimeEventTransaction: async context => [
                await result.getEvent(context),
            ],
        };
    });
}
