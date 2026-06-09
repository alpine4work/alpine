import {getContentReferencesAssumingViewAccessWithOptionalSpaceAccess} from "~/server/content/get_content_references_assuming_view_access_with_optional_space_access.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {FileTaskAuthorizer} from "~/server/tasks/data/authorization/file_task_authorizer.js";
import {getTaskCommentCount} from "~/server/tasks/data/get_task_comment_count.js";
import {
    authorizeTaskAccessAndGetCommentsSummaryAndNotesItemsIfExists,
    authorizeTaskItemAccessIfPossible,
    getTaskCollectionItemForAuthorization,
    getTaskItemForAuthorization,
} from "~/server/tasks/data/internal/authorize_task_item_access.js";
import {getTaskCommentsFromStartAssumingAuthorizedTask} from "~/server/tasks/data/internal/get_task_comments_from_start_assuming_authorized_task.js";
import type {
    TaskCommentsSummaryItem,
    TaskEssentialAttributesItemBase,
} from "~/server/tasks/data/internal/task_table.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.js";
import {captureResultPromise} from "~/shared/helpers/control/capture_result_promise.js";
import {mapResult} from "~/shared/helpers/control/map_result.js";
import {SiteId, TaskId} from "~/shared/id/types/id_types.js";
import {TaskCommentModel} from "~/shared/tasks/model/task_comment_model.js";
import {createTaskNotFoundError} from "~/shared/tasks/task_error_messages.js";
import {
    TaskNotesContentWithReferences,
    emptyTaskNotesContent,
} from "~/shared/tasks/task_notes_content_schema.js";
import {
    ServerSynchronizationCheckpoint,
    generateServerSynchronizationCheckpoint,
} from "~/shared/web_socket/server_synchronization_checkpoint.js";

export async function getTaskNotesContentAndOptionalInitialCommentsIfExists(
    context: ServerActionContext,
    {
        taskId,
        commentsLimit,
        onSiteId,
    }: {
        taskId: TaskId;
        commentsLimit: number;
        onSiteId?: (siteId: SiteId) => void;
    },
): Promise<{
    notes: {
        version: number;
        content: TaskNotesContentWithReferences;
    };
    initialComments: {
        checkpoint: ServerSynchronizationCheckpoint;
        commentCount: number;
        comments: ReadonlyArray<TaskCommentModel>;
        otherReferencedComments: ReadonlyArray<TaskCommentModel>;
    } | null;
} | null> {
    const authorizationPromiseResolver = createPromiseResolver<{
        item: TaskEssentialAttributesItemBase;
        commentsSummaryItem: TaskCommentsSummaryItem | null;
    }>();

    // Don't report unhandled rejections to this promise resolver as unhandled errors.
    // Otherwise if we can't find the task and return null we'll get an "Uncaught
    // exception" log with this error.
    authorizationPromiseResolver.promise.catch(() => {});

    const commentAuthorizationResultPromise = authorizationPromiseResolver.promise.then(
        async ({item}) => {
            const result = await authorizeTaskItemAccessIfPossible(context, item, "Comment", {
                getTaskItem: taskId => getTaskItemForAuthorization(context, taskId, null),
                getCollectionItem: collectionId =>
                    getTaskCollectionItemForAuthorization(context, collectionId, null),
            });

            return mapResult(result, () => item.spaceId);
        },
    );

    // Generate checkpoint before we start loading data. So when we backfill we include
    // any realtime events that happened while loading data.
    const checkpoint = generateServerSynchronizationCheckpoint();

    const [task, commentAuthorizationResultResult, commentsResult] = await runAllPromises([
        authorizeTaskAccessAndGetCommentsSummaryAndNotesItemsIfExists(
            context,
            taskId,
            "View",
            async result => {
                authorizationPromiseResolver.resolve(result);

                const {item, notesItem, commentsSummaryItem} = result;

                return {
                    notes: {
                        version: notesItem?.version ?? 0,
                        content: {
                            doc: notesItem?.content ?? emptyTaskNotesContent,
                            references:
                                await getContentReferencesAssumingViewAccessWithOptionalSpaceAccess(
                                    context,
                                    item.spaceId,
                                    FileTaskAuthorizer.bind({type: "TaskNotes", taskId}),
                                    notesItem?.content ?? emptyTaskNotesContent,
                                    // Preload small files so we don't have to show a placeholder for them. This
                                    // improves UX at the cost slowing the initial load. Right now we preload <100kb
                                    // files up to 400kb. We'll have to tune this to find the right balance between UX
                                    // and the performance hit.
                                    {withPreloadedFiles: true},
                                ),
                        },
                    },
                    commentsSummaryItem,
                };
            },
            {onSiteId},
        ).finally(() => {
            // Make sure the promise resolver doesn't hang forever waiting for a `SpaceId` in
            // failure scenarios.
            if (!authorizationPromiseResolver.isSettled()) {
                authorizationPromiseResolver.reject(createTaskNotFoundError(taskId));
            }
        }),

        // This promise may throw if the task isn't found because it depends on
        // `authorizationPromiseResolver`. If the task isn't found we want to return null,
        // not throw here. So `captureResultPromise()` to catch not found errors so we
        // don't throw them until after we check that the task exists.
        //
        // This gives us a result of a result. The inner result is whether or not we have
        // comment access and controls whether we return `comments` from this function or
        // not.
        captureResultPromise(commentAuthorizationResultPromise),

        captureResultPromise(
            getTaskCommentsFromStartAssumingAuthorizedTask(context, {
                taskId,
                // If we don't have comment authorization then throw in `getSpaceId` so we don't
                // continue loading more referenced comments or `TaskCommentModel`s.
                getSpaceId: () => commentAuthorizationResultPromise.then(unwrapResult),
                limit: commentsLimit,
                afterCommentIndex: null,
                beforeCommentIndex: null,
            }),
        ),
    ]);

    if (!task) return null;

    const {notes, commentsSummaryItem} = task;
    const commentAuthorizationResult = unwrapResult(commentAuthorizationResultResult);

    return {
        notes,

        // Only return the comments we fetched if the session actor has access to comments.
        // Otherwise we return null. A little wasteful since we will have fetched all the
        // comments before deciding to return null. But we expect the code path where
        // `commentAuthorizationResult.ok` is false to be much less common than the code
        // path where we need comments so we're ok being a little wasteful.
        initialComments: commentAuthorizationResult.ok
            ? (() => {
                  const {comments, otherReferencedComments} = unwrapResult(commentsResult);

                  const lastCommentIndex =
                      comments.length > 0 ? comments[comments.length - 1]!.index : -1;

                  return {
                      checkpoint,
                      commentCount: Math.max(
                          getTaskCommentCount(commentsSummaryItem),
                          // Make sure `commentCount` is consistent with `comments` in case of eventual
                          // consistency race conditions.
                          lastCommentIndex + 1,
                      ),
                      comments,
                      otherReferencedComments,
                  };
              })()
            : null,
    };
}
