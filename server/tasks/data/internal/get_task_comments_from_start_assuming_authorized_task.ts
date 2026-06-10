import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {runCommentsQuery} from "~/server/messaging/helpers/run_comments_query.js";
import {
    TaskCommentItemContextCache,
    createTaskCommentModelFromItem,
    getTaskCommentItemIfExists,
} from "~/server/tasks/data/internal/get_task_comment_item.js";
import {TaskTable} from "~/server/tasks/data/internal/task_table.js";
import {InternalError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {SpaceId, TaskId} from "~/shared/id/types/id_types.js";
import {
    MessageContentPayloadParent,
    iterateMessageContentPayloadParentIndexes,
} from "~/shared/messaging/message_schema.js";
import {TaskCommentModel} from "~/shared/tasks/model/task_comment_model.js";

export async function getTaskCommentsFromStartAssumingAuthorizedTask(
    context: ServerActionContext,
    {
        taskId,
        getSpaceId,
        limit,
        afterCommentIndex,
        beforeCommentIndex,
        consistency = "Eventual",
    }: {
        taskId: TaskId;
        getSpaceId: () => Promise<SpaceId>;
        limit: number;
        afterCommentIndex: number | null;
        beforeCommentIndex: number | null;
        consistency?: DynamoReadConsistency;
    },
): Promise<{
    comments: Array<TaskCommentModel>;
    otherReferencedComments: Array<TaskCommentModel>;
}> {
    if (limit === 0) return {comments: [], otherReferencedComments: []};

    const queryStartCommentIndex =
        typeof afterCommentIndex === "number" ? afterCommentIndex + 1 : 0;

    const queryEndCommentIndex = Math.min(
        queryStartCommentIndex + limit - 1,
        typeof beforeCommentIndex === "number" ? beforeCommentIndex - 1 : Number.MAX_SAFE_INTEGER,
    );

    const commentItems = await arrayFromAsyncIterable(
        runCommentsQuery(context, {
            cache: TaskCommentItemContextCache,
            cacheKeyPrefix: taskId,
            consistency,
            startIndex: queryStartCommentIndex,
            endIndex: queryEndCommentIndex,
            query: ({consistency, limit, startSortKey, endSortKey}) =>
                TaskTable.query(context, {
                    consistency,
                    limit,
                    partitionKey: {partitionType: "Task", taskId},
                    startSortKey,
                    endSortKey,
                }),
        }),
    );

    if (commentItems.length === 0) return {comments: [], otherReferencedComments: []};

    const startCommentIndex = commentItems[0]!.index;
    const endCommentIndex = commentItems[commentItems.length - 1]!.index;

    const spaceId = await getSpaceId();

    let otherReferencedCommentPromiseByIndex = new Map<number, Promise<void>>();
    const otherReferencedComments: Array<TaskCommentModel> = [];

    const loadOtherReferencedCommentFromParent = (parent: MessageContentPayloadParent) => {
        for (const index of iterateMessageContentPayloadParentIndexes(parent)) {
            loadOtherReferencedComment(index);
        }
    };

    const loadOtherReferencedComment = (commentIndex: number) => {
        // If this message is already in our loaded messages range then we don't need to
        // load it again.
        if (startCommentIndex <= commentIndex && commentIndex <= endCommentIndex) return;

        const promise = getOrSetDefaultMapValue(
            otherReferencedCommentPromiseByIndex,
            commentIndex,
            async () => {
                const item = await getTaskCommentItemIfExists(context, taskId, commentIndex, {
                    consistency,
                });
                if (!item) throw new InternalError("Parent comment not found");

                // Recursively load any referenced parent messages...
                if (item.payload.type === "Content" && item.payload.parent !== null) {
                    loadOtherReferencedCommentFromParent(item.payload.parent);
                }

                otherReferencedComments.push(
                    await createTaskCommentModelFromItem(context, spaceId, taskId, item),
                );
            },
        );

        // We await this promise later.
        void promise;
    };

    const comments = await runAllPromises(
        commentItems.map(item => {
            if (item.payload.type === "Content" && item.payload.parent !== null) {
                loadOtherReferencedCommentFromParent(item.payload.parent);
            }

            // Don't propagate `consistency` when loading model references. We accept
            // references can have eventual consistency.
            return createTaskCommentModelFromItem(context, spaceId, taskId, item);
        }),
    );

    // Keep loading other referenced comments until we have all of them. A referenced
    // comment may itself reference more comments.
    while (otherReferencedCommentPromiseByIndex.size > 0) {
        const promises = Array.from(otherReferencedCommentPromiseByIndex.values());
        otherReferencedCommentPromiseByIndex = new Map();
        await runAllPromises(promises);
    }

    return {
        comments,
        otherReferencedComments: otherReferencedComments.sort(
            (comment1, comment2) => comment1.index - comment2.index,
        ),
    };
}
