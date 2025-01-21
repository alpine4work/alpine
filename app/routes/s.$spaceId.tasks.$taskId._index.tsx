import {useCallback, useEffect} from "react";
import {useParams} from "react-router";
import {useSearchParams} from "react-router-dom";
import {useTaskClientStoreSearchAffinityManager} from "~/app/helpers/use_task_client_store_search_entity_affinity_manager.js";
import {useInboxBannerOutletContainer} from "~/client/inbox/use_inbox_banner_outlet_container.js";
import {getInitialLoadMessageCount} from "~/client/messaging/get_initial_load_message_count.js";
import {createMetaFunction} from "~/client/remix/create_meta_function.js";
import {getInitialAppRenderPlatform} from "~/client/remix/platform_context.js";
import {useRouteLayout} from "~/client/remix/route_layout_context.js";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema.js";
import {metaTitlePostfix, useUpdateMetaTitle} from "~/client/remix/use_update_meta_title.js";
import {taskDetailViewCommentSidebarWidth} from "~/client/styles/tasks_shared_styles.js";
import {useTaskStoreLoaderDataWithoutRetaining} from "~/client/tasks/core/task_realtime_client_context_provider.js";
import {getTaskGridViewLoadQueryLimit} from "~/client/tasks/get_task_grid_view_load_query_limit.js";
import {TaskDetailAndCommentsView} from "~/client/tasks/task_detail_and_comments_view.js";
import {getInboxEntry} from "~/server/notifications/data/notifications_table.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {
    getTaskNotesContent,
    getTaskNotesContentAndOptionalInitialComments,
} from "~/server/tasks/data/task_table.js";
import {createDynamoGeneralRealtimeItemSchema} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {isId} from "~/shared/id/id.js";
import {BrowserId, SpaceId, TaskId} from "~/shared/id/types/id_types.js";
import {InboxEntryModelSchema} from "~/shared/notifications/inbox_model.js";
import {Schema} from "~/shared/schema/schema.js";
import {batchStoreUpdates} from "~/shared/store/batch_store_updates.js";
import {TaskCommentModel} from "~/shared/tasks/model/task_comment_model.js";
import {addFallbackToTaskTitle} from "~/shared/tasks/model/task_title_model.js";
import {TaskGridViewExpansionStateSchema} from "~/shared/tasks/task_grid_view_expansion_state.js";
import {TaskNotesContentWithReferencesSchema} from "~/shared/tasks/task_notes_content_schema.js";
import {TaskQueryNormalizedFilters} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";
import {TaskRealtimeUpdateEventBackfillTask} from "~/shared/tasks/task_realtime_protocol.js";

const LoaderSchema = Schema.object({
    initialMetaTitleText: Schema.string,
    childrenGridViewExpansionState: TaskGridViewExpansionStateSchema,
    notesVersion: Schema.integer,
    notesContent: TaskNotesContentWithReferencesSchema,
    initialComments: Schema.object({
        commentCount: Schema.integer,
        lastCommentChangeTime: Schema.date.nullable(),
        comments: Schema.array(TaskCommentModel.schema()),
        otherReferencedComments: Schema.array(TaskCommentModel.schema()),
    }).nullable(),
    inboxEntry: createDynamoGeneralRealtimeItemSchema(InboxEntryModelSchema).nullable(),
});

export const meta = createMetaFunction(LoaderSchema, ({data: {initialMetaTitleText}}) => [
    {title: addFallbackToTaskTitle(initialMetaTitleText)},
]);

export async function loader({params, context: _context, request}: LoaderArgs) {
    const context = (await _context.actor.authenticate()).actor.authorizeSession();
    const taskId = Schema.id<TaskId>().deserialize(params.taskId ?? null);
    const spaceId = Schema.id<SpaceId>().deserialize(params.spaceId ?? null);

    const url = new URL(request.url);

    const clientInfo = context.loader.getClientInfo();
    const platform = getInitialAppRenderPlatform(clientInfo);

    const childrenQuery: {
        limit: number;
        filters: TaskQueryNormalizedFilters;
        sorts: ReadonlyArray<TaskQueryNormalizedSort>;
        shouldLoadGridViewExpandedChildTasksForBrowserId?: BrowserId;
    } = {
        limit: getTaskGridViewLoadQueryLimit(context.loader.getClientInfo()),

        filters: {
            displayStatusFilter: {
                ifOpenInactive: true,
                ifOpenActive: true,
                ifClosed: true,
            },
            parentFilter: {
                parentTaskId: taskId,
            },
        },
        sorts: [
            {
                type: "ParentPosition",
                direction: "Ascending",
                missing: "Last",
            },
            {
                type: "CreatedTime",
                direction: "Ascending",
                missing: "Last",
            },
        ],

        shouldLoadGridViewExpandedChildTasksForBrowserId: context.loader.getBrowserId(),
    };

    const showComments = url.searchParams.get("comments") === "show";

    const [
        {queries, extraQueries, updateEvent},
        {
            notes: {version: notesVersion, content: notesContent},
            initialComments,
        },
        inboxEntry,
    ] = await runAllPromises([
        context.tasks.loadQueries(spaceId, {
            queries: [childrenQuery],
            taskIds: [taskId],
            collectionIds: [],
        }),
        showComments && platform !== "mobile"
            ? // NOCOMMIT: Test view access with `comments=show`.
              getTaskNotesContentAndOptionalInitialComments(context, {
                  taskId,
                  commentsLimit: getInitialLoadMessageCount(context.loader.getClientInfo()),
              })
            : getTaskNotesContent(context, taskId).then(notes => ({notes, initialComments: null})),
        url.searchParams.get("inbox") === "show"
            ? getInboxEntry(context, {
                  spaceId,
                  key: {type: "Task", taskId},
              })
            : null,
    ]);

    const backfillTask = updateEvent.backfillTasks.find(
        (
            backfillTask,
        ): backfillTask is TaskRealtimeUpdateEventBackfillTask & {type: "Authorized"} =>
            backfillTask.type === "Authorized" && backfillTask.task.id === taskId,
    );
    const childrenQueryOutput = assertExists(queries[0]);

    return jsonWithSchema(
        LoaderSchema,
        {
            initialMetaTitleText: backfillTask?.task.getTitle().getText() ?? "",
            childrenGridViewExpansionState: childrenQueryOutput.gridViewExpansionState,
            notesVersion,
            notesContent,
            initialComments,
            inboxEntry,
        },
        {
            propagateEventData: {
                context: {taskId},
            },
            taskStoreLoaderData: {
                queries: [
                    {
                        limit: childrenQuery.limit,
                        filters: childrenQuery.filters,
                        sorts: childrenQuery.sorts,
                        loadedState: childrenQueryOutput.loadedState,
                    },
                    ...extraQueries,
                ],
                taskIds: [taskId],
                collectionIds: [],
                updateEvent,
            },
        },
    );
}

export default function TaskRoute() {
    const {taskId, spaceId} = useParams();
    const [searchParams, setSearchParams] = useSearchParams();
    assert(taskId && isId<TaskId>(taskId));
    assert(spaceId && isId<SpaceId>(spaceId));

    const {
        childrenGridViewExpansionState: initialChildrenGridViewExpansionState,
        notesVersion: initialNotesVersion,
        notesContent: initialNotesContent,
        initialComments,
        inboxEntry,
    } = useLoaderDataWithSchema(LoaderSchema);
    const {
        queries: [childrenQuery],
        taskSubscriptions: [taskSubscription],
    } = useTaskStoreLoaderDataWithoutRetaining();
    assert(childrenQuery && taskSubscription);

    const routeLayout = useRouteLayout();

    // Retain our queries so they aren't destroyed while we're using them.
    useEffect(() => {
        childrenQuery.retain();
        taskSubscription.retain();

        return () => {
            // Release after a microtask in case the component is re-rendering which will
            // synchronously call `retain()` again.
            scheduleMicrotask(() => {
                batchStoreUpdates(() => {
                    childrenQuery.release();
                    taskSubscription.release();
                });
            });
        };
    }, [childrenQuery, taskSubscription]);

    const updateMetaTitle = useUpdateMetaTitle();

    // Update our document's title whenever the task's title changes.
    useEffect(() => {
        const update = () => {
            updateMetaTitle(
                `${addFallbackToTaskTitle(
                    taskSubscription.taskEntryStore.getSnapshot().task?.getTitle().getText() ?? "",
                )}${metaTitlePostfix}`,
            );
        };

        update();
        return taskSubscription.taskEntryStore.subscribe(update);
    }, [taskSubscription.taskEntryStore, updateMetaTitle]);

    const commentIndexString = searchParams.get("comment");
    const initialScrollToCommentIndex = commentIndexString
        ? parseInt(commentIndexString, 10)
        : null;

    const affinityManager = useTaskClientStoreSearchAffinityManager(`Task:${taskId}`);

    const showComments = searchParams.get("comments") === "show";

    const setShowComments = useCallback(
        (showComments: boolean) => {
            setSearchParams(
                searchParams => {
                    const newSearchParams = new URLSearchParams(searchParams);

                    if (showComments) {
                        newSearchParams.set("comments", "show");
                    } else {
                        newSearchParams.delete("comments");
                    }

                    return newSearchParams;
                },
                {
                    replace: true,
                    // Don't revalidate when updating search params from here. We can't use the
                    // stable `shouldRevalidate` route function because if the user navigates to
                    // a new URL we want to load new data and re-render the route.
                    unstable_shouldRevalidate: false,
                },
            );
        },
        [setSearchParams],
    );

    // Can't show comments in narrow route layouts. So clear the `showComments`
    // search param if we have it.
    useEffect(() => {
        if (showComments && routeLayout === "narrow") {
            setShowComments(false);
        }
    }, [routeLayout, setShowComments, showComments]);

    // We keep track in `localStorage` of whether comments were opened in wide
    // `routeLayout` task detail views so that when the user navigates back to the
    // task detail view we can preserve the comment open/close state.
    //
    // We read this state in `convertPeekPathToSpacePath()`.
    //
    // NOCOMMIT: Consider testing this?
    useEffect(() => {
        if (routeLayout === "narrow") return;

        if (!showComments) {
            localStorage.removeItem(`cyberworlds/taskShowComments/${taskSubscription.taskId}`);
        } else {
            localStorage.setItem(`cyberworlds/taskShowComments/${taskSubscription.taskId}`, "true");
        }
    }, [routeLayout, showComments, taskSubscription.taskId]);

    return useInboxBannerOutletContainer(
        {
            initialEntry: inboxEntry,
            maxWidth: "full",
            sidebarRightWidth: taskDetailViewCommentSidebarWidth,
        },
        <TaskDetailAndCommentsView
            // Remount when the `TaskId` changes.
            key={taskSubscription.taskId}
            taskSubscription={taskSubscription}
            childrenQuery={childrenQuery}
            affinityManager={affinityManager}
            initialChildrenGridViewExpansionState={initialChildrenGridViewExpansionState}
            initialNotesVersion={initialNotesVersion}
            initialNotesContent={initialNotesContent}
            showComments={showComments && routeLayout !== "narrow"}
            onShowCommentsChange={setShowComments}
            initialComments={initialComments}
            initialScrollToCommentIndex={initialScrollToCommentIndex}
        />,
    );
}
