import {useCallback, useEffect, useState} from "react";
import {useParams} from "react-router";
import {useSearchParams} from "react-router-dom";
import {useTaskClientStoreSearchAffinityManager} from "~/app/helpers/use_task_client_store_search_entity_affinity_manager.js";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {useReporter} from "~/client/design/reporter.js";
import {useEvents} from "~/client/helpers/lifecycle/use_event.js";
import {batchStoreUpdates} from "~/client/helpers/store/batch_store_updates.js";
import {useStore} from "~/client/helpers/store/use_store.js";
import {InboxBannerOutletContainer} from "~/client/inbox/inbox_banner_outlet_container.js";
import {getInitialLoadMessageCount} from "~/client/messaging/messaging_view.js";
import {createMetaFunction} from "~/client/remix/create_meta_function.js";
import {getInitialAppRenderIsMobile, useIsMobile} from "~/client/remix/use_is_mobile.js";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema.js";
import {metaTitlePostfix, useUpdateMetaTitle} from "~/client/remix/use_update_meta_title.js";
import {useTaskStoreLoaderDataWithoutRetaining} from "~/client/tasks/core/task_realtime_client_context_provider.js";
import {getTaskGridViewLoadQueryLimit} from "~/client/tasks/get_task_grid_view_load_query_limit.js";
import {TaskCommentsView} from "~/client/tasks/task_comments_view.js";
import {TaskDetailNotesContentEditorWebSocketClient} from "~/client/tasks/task_detail_notes_content_editor_web_socket_client.js";
import {TaskDetailView} from "~/client/tasks/task_detail_view.js";
import {TaskGridViewDndContext} from "~/client/tasks/task_grid_view_dnd_context.js";
import {useWebSocketErrorDialog} from "~/client/web_socket/use_web_socket.js";
import {getInboxEntry} from "~/server/notifications/data/notifications_table.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {
    getTaskNotesContent,
    getTaskNotesContentAndInitialComments,
} from "~/server/tasks/data/task_table.js";
import {createDynamoGeneralRealtimeItemSchema} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {isId} from "~/shared/id/id.js";
import {BrowserId, SpaceId, TaskId} from "~/shared/id/types/id_types.js";
import {MessagingRealtimeEvent} from "~/shared/messaging/messaging_realtime_protocol.js";
import {InboxEntryModelSchema} from "~/shared/notifications/inbox_model.js";
import {Schema} from "~/shared/schema/schema.js";
import {taskDetailViewCommentSidebarWidth} from "~/shared/styles/tasks_shared_styles.js";
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
    const isMobile = getInitialAppRenderIsMobile(clientInfo);

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
        isMobile
            ? getTaskNotesContent(context, taskId).then(notes => ({notes, initialComments: null}))
            : getTaskNotesContentAndInitialComments(context, {
                  taskId,
                  commentsLimit: getInitialLoadMessageCount(context.loader.getClientInfo()),
              }),
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

export default function TaskRoute({
    withMobileLayout: withMobileLayoutProp = false,
}: {
    withMobileLayout?: boolean;
}) {
    const {taskId, spaceId} = useParams();
    const [searchParams] = useSearchParams();
    assert(taskId && isId<TaskId>(taskId));
    assert(spaceId && isId<SpaceId>(spaceId));

    const {
        childrenGridViewExpansionState,
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

    const isMobile = useIsMobile();
    const withMobileLayout = withMobileLayoutProp || isMobile;

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
    const commentIndex = commentIndexString ? parseInt(commentIndexString, 10) : null;

    const affinityManager = useTaskClientStoreSearchAffinityManager(`Task:${taskId}`);

    const getCommentUrl = useCallback(
        (commentIndex: number) =>
            new URL(`/s/${spaceId}/tasks/${taskId}?comment=${commentIndex}`, window.location.href),
        [taskId, spaceId],
    );
    const context = useAppContext();
    const reporter = useReporter();
    const events = useEvents({
        getContext: () => context,
        getReporter: () => reporter,
    });

    const [notesClient, setNotesClient] = useState(() => {
        return new TaskDetailNotesContentEditorWebSocketClient(events.getContext, {
            taskId,
            initialNotesVersion,
            initialNotesContent,
            displayError: (title, error) => events.getReporter().displayError(title, error),
        });
    });

    // Re-initialize state if the `TaskId` changes.
    if (notesClient.taskId !== taskId) {
        setNotesClient(() => {
            return new TaskDetailNotesContentEditorWebSocketClient(events.getContext, {
                taskId,
                initialNotesVersion,
                initialNotesContent,
                displayError: (title, error) => events.getReporter().displayError(title, error),
            });
        });
    }

    const [shouldConnect] = useState(true);

    useEffect(() => {
        if (!shouldConnect) return;

        notesClient.connect();
        return () => {
            notesClient.disconnect();
        };
    }, [notesClient, shouldConnect]);

    const webSocketState = useStore(notesClient.webSocketState);

    // Show the "Lost connection" error dialog if any error occurs in our WebSocket
    // connection.
    useWebSocketErrorDialog(notesClient, webSocketState);

    const subscribeToCommentsEvents = useCallback(
        (subscriber: (event: MessagingRealtimeEvent<TaskCommentModel>) => void) => {
            return notesClient.subscribeToCommentEvents(subscriber);
        },
        [notesClient],
    );

    const node = (
        <Box
            flexGrow="1"
            overflow="hidden"
            position="relative"
            zIndex="0"
            display="flex"
            justifyContent="center"
            flexDirection="row"
        >
            <TaskGridViewDndContext store={taskSubscription.store}>
                <TaskDetailView
                    // Remount when the `TaskId` changes.
                    key={taskSubscription.taskId}
                    withMobileLayout={withMobileLayout}
                    taskSubscription={taskSubscription}
                    childrenQuery={childrenQuery}
                    affinityManager={affinityManager}
                    initialChildrenGridViewExpansionState={childrenGridViewExpansionState}
                    notesClient={notesClient}
                />
            </TaskGridViewDndContext>
            {!withMobileLayout && (
                <Box
                    flexShrink="0"
                    borderLeft="grey-10"
                    width={taskDetailViewCommentSidebarWidth}
                    height="full"
                    overflow="hidden"
                >
                    <TaskCommentsView
                        key={taskId}
                        taskId={taskId}
                        withMobileLayout={withMobileLayout}
                        initialComments={initialComments}
                        initialScrollToCommentIndex={commentIndex}
                        getCommentUrl={getCommentUrl}
                        isConnected={webSocketState.isConnected}
                        procedures={notesClient.procedures}
                        subscribeToEvents={subscribeToCommentsEvents}
                    />
                </Box>
            )}
        </Box>
    );

    if (!inboxEntry) {
        return node;
    } else {
        return (
            <InboxBannerOutletContainer
                initialEntry={inboxEntry}
                withMobileLayout={withMobileLayout}
                maxWidth="full"
                borderBottom="grey-10"
                sidebarRightWidth={taskDetailViewCommentSidebarWidth}
            >
                {node}
            </InboxBannerOutletContainer>
        );
    }
}
