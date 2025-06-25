import {parseAbsolute, toCalendarDate} from "@internationalized/date";
import {useCallback, useEffect, useMemo, useState} from "react";
import {flushSync} from "react-dom";
import {ShouldRevalidateFunction, useParams} from "react-router";
import {useSearchParams} from "react-router-dom";
import {useTaskClientStoreSearchAffinityManager} from "~/app/helpers/use_task_client_store_search_entity_affinity_manager.js";
import {useAppContext} from "~/client/context/app_context.js";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {useInboxBannerOutletContainer} from "~/client/inbox/use_inbox_banner_outlet_container.js";
import {getInitialLoadMessageCount} from "~/client/messaging/get_initial_load_message_count.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {createMetaFunction} from "~/client/remix/create_meta_function.js";
import {getInitialAppRenderPlatform} from "~/client/remix/platform_context.js";
import {useRouteLayout} from "~/client/remix/route_layout_context.js";
import {useCurrentDate} from "~/client/remix/use_current_time_rounded_to_hour.js";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema.js";
import {metaTitlePostfix, useUpdateMetaTitle} from "~/client/remix/use_update_meta_title.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {taskDetailViewCommentSidebarWidth} from "~/client/styles/tasks_shared_styles.js";
import {disableTaskGridViewAnimationsForTaskIdUntilNextBrowserPaint} from "~/client/tasks/core/disable_task_grid_view_animations_until_next_browser_paint.js";
import {TaskClientQuery} from "~/client/tasks/core/task_client_query.js";
import {
    TaskClientStoreSearchAffinityManager,
    TaskClientStoreUndoManager,
} from "~/client/tasks/core/task_client_store.js";
import {TaskClientTaskSubscription} from "~/client/tasks/core/task_client_task_subscription.js";
import {TaskQueryNormalizedFiltersInitialFieldsModel} from "~/client/tasks/core/task_query_normalized_filters_initial_fields_model.js";
import {unknownTaskQueryFromServerRetentionPeriodMs} from "~/client/tasks/core/task_realtime_client.js";
import {useTaskStoreLoaderDataWithoutRetaining} from "~/client/tasks/core/task_realtime_client_context_provider.js";
import {getTaskGridViewLoadQueryLimit} from "~/client/tasks/get_task_grid_view_load_query_limit.js";
import {TaskDetailAndCommentsView} from "~/client/tasks/task_detail_and_comments_view.js";
import {getInboxEntry} from "~/server/notifications/data/notifications_table.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {isSearchFavoriteEntity} from "~/server/search/data/table/search_entity_table.js";
import {authorizeSpaceAccessIfPossible, getAccount} from "~/server/spaces/spaces_table.js";
import {
    createTaskNotFoundError,
    getTaskNotesContentAndOptionalInitialComments,
    getTaskNotesContentIfExists,
} from "~/server/tasks/data/task_table.js";
import {createDynamoGeneralRealtimeItemSchema} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {NotFoundError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {HybridLogicalClock} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.js";
import {captureResultPromise} from "~/shared/helpers/control/capture_result_promise.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {roundDateToHour} from "~/shared/helpers/date/round_date_to_hour.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.js";
import {iterableWithIndex} from "~/shared/helpers/iterable/iterable_with_index.js";
import {emptySet} from "~/shared/helpers/set/empty_set.js";
import {generateOrderKeysBetween} from "~/shared/helpers/sort/order_key.js";
import {isId} from "~/shared/id/id.js";
import {AccountId, BrowserId, SpaceId, TaskId} from "~/shared/id/types/id_types.js";
import {InboxEntryModelSchema} from "~/shared/notifications/inbox_model.js";
import {Schema} from "~/shared/schema/schema.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {batchStoreUpdates} from "~/shared/store/batch_store_updates.js";
import {TaskActionModel} from "~/shared/tasks/actions/task_action_model.js";
import {TaskCommentModel} from "~/shared/tasks/model/task_comment_model.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";
import {TaskGridViewExpansionStateSchema} from "~/shared/tasks/task_grid_view_expansion_state.js";
import {
    TaskNotesContentWithReferencesSchema,
    emptyTaskNotesContentWithReferences,
} from "~/shared/tasks/task_notes_content_schema.js";
import {deserializeTaskQueryFiltersSearchParam} from "~/shared/tasks/task_query_filter.js";
import {
    TaskQueryNormalizedFilters,
    normalizeTaskQueryFilters,
} from "~/shared/tasks/task_query_normalized_filters.js";
import {
    TaskQueryNormalizedFiltersInitialFields,
    getTaskQueryNormalizedFiltersInitialFields,
} from "~/shared/tasks/task_query_normalized_filters_initial_fields.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";
import {TaskRealtimeUpdateEventBackfillTask} from "~/shared/tasks/task_realtime_protocol.js";
import {TaskRealtimeLoadQueriesOutput} from "~/shared/tasks/task_realtime_service_procedure_schemas.js";
import {addFallbackToTaskTitle, emptyTaskTitleModel} from "~/shared/tasks/title/task_title.js";

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
    isFavorite: Schema.boolean,
    initialFieldsAssignee: AccountModel.schema.nullable(),
});

export const meta = createMetaFunction(LoaderSchema, ({data: {initialMetaTitleText}}) => [
    {title: addFallbackToTaskTitle(initialMetaTitleText)},
]);

export async function loader({params, context: unauthenticatedContext, request}: LoaderArgs) {
    const context = await unauthenticatedContext.actor.authenticate();
    const taskId = Schema.id<TaskId>().deserialize(params.taskId ?? null);
    const spaceId = Schema.id<SpaceId>().deserialize(params.spaceId ?? null);

    const url = new URL(request.url);

    const clientInfo = context.loader.getClientInfo();
    const platform = getInitialAppRenderPlatform(clientInfo);

    const isSpaceAccessAuthorized = (await authorizeSpaceAccessIfPossible(context, spaceId)).ok;

    const createSearchParam = url.searchParams.get("create");
    const isCreatingTask = createSearchParam !== null;
    const showComments = !isCreatingTask && url.searchParams.get("comments") === "show";
    const showInboxEntry = url.searchParams.get("inbox") === "show";

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

        // We only store grid view expansion state for accounts with space access.
        shouldLoadGridViewExpandedChildTasksForBrowserId: isSpaceAccessAuthorized
            ? context.loader.getBrowserId()
            : undefined,
    };

    let initialFields: TaskQueryNormalizedFiltersInitialFields | null = null;
    if (createSearchParam !== null && createSearchParam.length > 0) {
        const initialTime = context.loader.getInitialTime();

        const currentTimeRoundedToHour = roundDateToHour(initialTime);
        const currentDate = toCalendarDate(
            parseAbsolute(
                currentTimeRoundedToHour.toISOString(),
                context.loader.getClientInfo().timeZone,
            ),
        );

        const filters = deserializeTaskQueryFiltersSearchParam(createSearchParam);

        const normalizedFiltersResult = normalizeTaskQueryFilters(filters, {
            currentDate,
            currentAccountId:
                context.actor.type === "Session" ? context.actor.getAccountId() : null,
        });
        if (normalizedFiltersResult.type === "Possible") {
            initialFields = getTaskQueryNormalizedFiltersInitialFields(
                normalizedFiltersResult.normalizedFilters,
                {
                    currentDate,
                    currentAccountId:
                        context.actor.type === "Session" ? context.actor.getAccountId() : null,
                },
            );
        }
    }

    const [
        loadQueriesOutputResult,
        task,
        inboxEntry,
        isFavorite,
        initialFieldsAssignee,
        initialFieldsLoadCollectionsResult,
    ] = await runAllPromises([
        captureResultPromise(
            context.tasks.loadQueries(spaceId, {
                queries: [childrenQuery],
                taskIds: [taskId],
                collectionIds: [],
            }),
        ),
        showComments && platform !== "mobile"
            ? getTaskNotesContentAndOptionalInitialComments(context, {
                  taskId,
                  commentsLimit: getInitialLoadMessageCount(context.loader.getClientInfo()),
              })
            : getTaskNotesContentIfExists(context, taskId).then(notes =>
                  notes
                      ? {
                            notes,
                            initialComments: null,
                        }
                      : null,
              ),
        isSpaceAccessAuthorized && showInboxEntry
            ? getInboxEntry(context.actor.authorizeSession(), {
                  spaceId,
                  key: {type: "Task", taskId},
              })
            : null,
        isSearchFavoriteEntity(context, {
            spaceId,
            entityId: `Task:${taskId}`,
        }),

        // Load data needed for initial fields.
        initialFields?.assigneeId ? getAccount(context, spaceId, initialFields.assigneeId) : null,
        initialFields && initialFields.collectionIds.size > 0
            ? context.tasks.loadQueries(spaceId, {
                  queries: [],
                  taskIds: [],
                  collectionIds: Array.from(initialFields.collectionIds),
              })
            : null,
    ]);

    let loadQueriesOutput: TaskRealtimeLoadQueriesOutput | null;

    if (!isCreatingTask) {
        if (!task) throw createTaskNotFoundError(taskId);
        loadQueriesOutput = unwrapResult(loadQueriesOutputResult);
    } else {
        if (loadQueriesOutputResult.ok) {
            loadQueriesOutput = loadQueriesOutputResult.value;
        }
        // If the `create` search param is set, the task doesn't exist, and
        // `loadQueries()` throws a `NotFoundError` then ignore the error since we're
        // ok rendering an empty task we create later.
        else if (!task && loadQueriesOutputResult.error instanceof NotFoundError) {
            loadQueriesOutput = null;
        } else {
            throw loadQueriesOutputResult.error;
        }
    }

    const backfillTask = loadQueriesOutput?.updateEvent.backfillTasks.find(
        (
            backfillTask,
        ): backfillTask is TaskRealtimeUpdateEventBackfillTask & {type: "Authorized"} =>
            backfillTask.type === "Authorized" && backfillTask.task.id === taskId,
    );

    return jsonWithSchema(
        LoaderSchema,
        {
            initialMetaTitleText: backfillTask?.task.getTitle().getText() ?? "",
            childrenGridViewExpansionState:
                loadQueriesOutput?.queries[0]?.gridViewExpansionState ?? null,
            notesVersion: task?.notes.version ?? 0,
            notesContent: task?.notes.content ?? emptyTaskNotesContentWithReferences,
            initialComments: task?.initialComments ?? null,
            inboxEntry,
            isFavorite,
            initialFieldsAssignee,
        },
        {
            propagateEventData: {
                context: {taskId},
            },
            taskStoreLoaderData: loadQueriesOutput
                ? {
                      queries: [
                          {
                              limit: childrenQuery.limit,
                              filters: childrenQuery.filters,
                              sorts: childrenQuery.sorts,
                              loadedState: assertExists(loadQueriesOutput.queries[0]).loadedState,
                          },
                          ...loadQueriesOutput.extraQueries,
                      ],
                      taskIds: [taskId],
                      collectionIds: [],
                      updateEvent: loadQueriesOutput.updateEvent,
                  }
                : initialFields && initialFields.collectionIds.size > 0
                ? {
                      queries: [],
                      taskIds: [],
                      collectionIds: Array.from(initialFields.collectionIds),
                      updateEvent: assertExists(initialFieldsLoadCollectionsResult).updateEvent,
                  }
                : undefined,
        },
    );
}

// We don't need to reload when certain search params change.
export const shouldRevalidate: ShouldRevalidateFunction = ({
    currentUrl: originalCurrentUrl,
    nextUrl: originalNextUrl,
}) => {
    const currentUrl = new URL(originalCurrentUrl);
    const nextUrl = new URL(originalNextUrl);

    // Used when creating tasks:
    nextUrl.searchParams.delete("create");
    currentUrl.searchParams.delete("create");

    // Used to focus the task:
    nextUrl.searchParams.delete("focus");
    currentUrl.searchParams.delete("focus");

    // Used to open comments:
    nextUrl.searchParams.delete("comments");
    currentUrl.searchParams.delete("comments");

    return nextUrl.toString() !== currentUrl.toString();
};

export default function TaskRoute() {
    const clientInfo = useClientInfo();
    const context = useAppContext();
    const {currentAccount} = useSpaceContext();
    const currentDate = useCurrentDate();
    const {taskId, spaceId} = useParams();
    const [searchParams, setSearchParams] = useSearchParams();
    assert(taskId && isId<TaskId>(taskId));
    assert(spaceId && isId<SpaceId>(spaceId));

    const createSearchParam = searchParams.get("create");
    const isCreatingTask = createSearchParam !== null;
    const showComments = !isCreatingTask && searchParams.get("comments") === "show";

    const [shouldInitiallyFocus] = useState(searchParams.get("focus") === "");

    const {
        childrenGridViewExpansionState: initialChildrenGridViewExpansionState,
        notesVersion: initialNotesVersion,
        notesContent: initialNotesContent,
        initialComments,
        inboxEntry,
        isFavorite: initialIsFavorite,
        initialFieldsAssignee,
    } = useLoaderDataWithSchema(LoaderSchema);
    const {
        store,
        queries: [childrenQueryFromLoader = null],
        taskSubscriptions: [taskSubscriptionFromLoader = null],
        collectionSubscriptions: initialFieldsCollectionSubscriptions,
    } = useTaskStoreLoaderDataWithoutRetaining();

    const [
        newlyCreatedTaskSubscriptionAndChildrenQuery,
        setNewlyCreatedTaskSubscriptionAndChildrenQuery,
    ] = useState<{
        taskSubscription: TaskClientTaskSubscription;
        childrenQuery: TaskClientQuery;
    } | null>(null);

    if (!isCreatingTask && !newlyCreatedTaskSubscriptionAndChildrenQuery) {
        assert(childrenQueryFromLoader && taskSubscriptionFromLoader);
    } else {
        // Either both `childrenQuery` and `taskSubscription` exist or neither of
        // them exist (when creating a new task).
        assert(
            (childrenQueryFromLoader && taskSubscriptionFromLoader) ||
                (!childrenQueryFromLoader && !taskSubscriptionFromLoader),
        );
    }

    // If we get a children query or task subscription from the server then null
    // out the newly created children query and task subscription.
    if (
        newlyCreatedTaskSubscriptionAndChildrenQuery &&
        (childrenQueryFromLoader || taskSubscriptionFromLoader)
    ) {
        setNewlyCreatedTaskSubscriptionAndChildrenQuery(null);
    }

    const taskSubscription =
        taskSubscriptionFromLoader ??
        newlyCreatedTaskSubscriptionAndChildrenQuery?.taskSubscription ??
        null;
    const childrenQuery =
        childrenQueryFromLoader ??
        newlyCreatedTaskSubscriptionAndChildrenQuery?.childrenQuery ??
        null;

    const routeLayout = useRouteLayout();

    // Retain our queries so they aren't destroyed while we're using them.
    useEffect(() => {
        childrenQuery?.retain();
        taskSubscription?.retain();

        return () => {
            if (childrenQuery || taskSubscription) {
                // Release after a microtask in case the component is re-rendering which will
                // synchronously call `retain()` again.
                scheduleMicrotask(() => {
                    batchStoreUpdates(() => {
                        childrenQuery?.release();
                        taskSubscription?.release();
                    });
                });
            }
        };
    }, [childrenQuery, taskSubscription]);

    // Remove the `create` search param.
    useEffect(() => {
        if ((childrenQuery || taskSubscription) && searchParams.has("create")) {
            const newSearchParams = new URLSearchParams(searchParams);
            newSearchParams.delete("create");
            setSearchParams(newSearchParams, {replace: true});
        }
    }, [childrenQuery, searchParams, setSearchParams, taskSubscription]);

    // Remove the `focus` search param.
    useEffect(() => {
        if (searchParams.has("focus")) {
            const newSearchParams = new URLSearchParams(searchParams);
            newSearchParams.delete("focus");
            setSearchParams(newSearchParams, {replace: true});
        }
    }, [searchParams, setSearchParams]);

    const updateMetaTitle = useUpdateMetaTitle();

    // Update our document's title whenever the task's title changes.
    useEffect(() => {
        const update = () => {
            updateMetaTitle(
                `${addFallbackToTaskTitle(
                    taskSubscription?.taskEntryStore.getSnapshot().task?.getTitle().getText() ?? "",
                )}${metaTitlePostfix}`,
            );
        };

        update();
        return taskSubscription?.taskEntryStore.subscribe(update);
    }, [taskSubscription?.taskEntryStore, updateMetaTitle]);

    const commentIndexString = searchParams.get("comment");
    const initialScrollToCommentIndex = commentIndexString
        ? parseInt(commentIndexString, 10)
        : null;

    const affinityManager = useTaskClientStoreSearchAffinityManager(
        taskSubscription ? `Task:${taskId}` : null,
    );

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
    useEffect(() => {
        if (routeLayout === "narrow") return;

        if (!showComments) {
            localStorage.removeItem(`cyberworlds/taskShowComments/${taskId}`);
        } else {
            localStorage.setItem(`cyberworlds/taskShowComments/${taskId}`, "true");
        }
    }, [routeLayout, showComments, taskId]);

    const defaultInitialFields = useMemo(
        (): TaskQueryNormalizedFiltersInitialFields => ({
            status: "Open",
            collectionIds: emptySet,
            priority: null,
            title: "",
            assigneeId: currentAccount?.id ?? null,
            assigneeStatus: "Inactive",
            dueDate: null,
        }),
        [currentAccount?.id],
    );

    const initialFields = useMemo((): TaskQueryNormalizedFiltersInitialFields => {
        // By default, if initial fields weren't specified then we set the `assigneeId`
        // to the current account and that's it.
        //
        // That way the new task shows up in the "My tasks" view.
        if (
            childrenQuery ||
            taskSubscription ||
            !createSearchParam ||
            createSearchParam.length === 0
        ) {
            return defaultInitialFields;
        }

        const filters = deserializeTaskQueryFiltersSearchParam(createSearchParam);

        const normalizedFiltersResult = normalizeTaskQueryFilters(filters, {
            currentDate,
            currentAccountId: currentAccount?.id ?? null,
        });
        if (normalizedFiltersResult.type === "Impossible") return defaultInitialFields;

        return getTaskQueryNormalizedFiltersInitialFields(
            normalizedFiltersResult.normalizedFilters,
            {
                currentDate,
                currentAccountId: currentAccount?.id ?? null,
            },
        );
    }, [
        childrenQuery,
        createSearchParam,
        currentAccount?.id,
        currentDate,
        defaultInitialFields,
        taskSubscription,
    ]);

    const initialFieldsCollectionSubscriptionById = useMemo(
        () =>
            new Map(
                initialFieldsCollectionSubscriptions.map(collectionSubscription => [
                    collectionSubscription.collectionId,
                    collectionSubscription,
                ]),
            ),
        [initialFieldsCollectionSubscriptions],
    );

    // Retain the collection subscriptions from `initialFields.collectionIds`. So
    // we keep those collections up-to-date in realtime.
    useEffect(() => {
        for (const collectionId of initialFields.collectionIds) {
            const collectionSubscription = assertExists(
                initialFieldsCollectionSubscriptionById.get(collectionId),
            );

            collectionSubscription.retain();
        }

        return () => {
            // Release after a microtask in case the effect re-runs in which case we'll
            // synchronously call `retain()` again.
            scheduleMicrotask(() => {
                for (const collectionId of initialFields.collectionIds) {
                    const collectionSubscription = assertExists(
                        initialFieldsCollectionSubscriptionById.get(collectionId),
                    );

                    collectionSubscription.release();
                }
            });
        };
    }, [initialFields.collectionIds, initialFieldsCollectionSubscriptionById]);

    const initialFieldsModel = useMemo((): TaskQueryNormalizedFiltersInitialFieldsModel => {
        return {
            status: initialFields.status,
            collectionIds: initialFields.collectionIds,
            priority: initialFields.priority,
            titleUpdate:
                initialFields.title.length > 0
                    ? emptyTaskTitleModel.get().replace(0, 0, initialFields.title)
                    : null,
            assignee:
                initialFields.assigneeId === currentAccount?.id
                    ? currentAccount
                    : initialFieldsAssignee,
            assigneeStatus: initialFields.assigneeStatus,
            dueDate: initialFields.dueDate,
            getReferencedCollectionEntryStore: collectionId => {
                return assertExists(initialFieldsCollectionSubscriptionById.get(collectionId))
                    .collectionEntryStore;
            },
        };
    }, [
        currentAccount,
        initialFields.assigneeId,
        initialFields.assigneeStatus,
        initialFields.collectionIds,
        initialFields.dueDate,
        initialFields.priority,
        initialFields.status,
        initialFields.title,
        initialFieldsAssignee,
        initialFieldsCollectionSubscriptionById,
    ]);

    const commitActionTransactionAndCreateIfNeeded = useEvent(
        (
            getActions: () => Iterable<TaskActionModel>,
            {
                undoManager,
                affinityManager,
            }: {
                undoManager: TaskClientStoreUndoManager | null;
                affinityManager: TaskClientStoreSearchAffinityManager;
            },
        ): {
            finally: (callback: () => void) => void;
        } => {
            if (taskSubscription) {
                return store.commitTaskActionTransaction(context, getActions(), {
                    undoManager,
                    affinityManager,
                });
            }

            // Currently, accounts without space access can't edit tasks. The max
            // permission level of `urlGrant` is `View`.
            assert(currentAccount);

            // Make sure any state update from the `onGhostTaskCreated` callback runs in
            // the same React commit as our store updates (which use
            // `useSyncExternalStore()`).
            return flushSync(() => {
                return batchStoreUpdates(() => {
                    disableTaskGridViewAnimationsForTaskIdUntilNextBrowserPaint(taskId);

                    const createTime = store.clock.now();

                    const actions: Array<TaskActionModel> = [
                        {
                            type: "UpdateTask",
                            time: createTime,
                            taskId,
                            taskAction: {
                                type: "Create",
                                creatorId: currentAccount.id,
                                creatorTimeZone: clientInfo.timeZone,
                            },
                        },
                    ];

                    pushTaskQueryNormalizedFiltersInitialFieldsActions(
                        clientInfo.timeZone,
                        currentAccount.id,
                        store.clock,
                        taskId,
                        initialFieldsModel,
                        actions,
                    );

                    const undoableSliceStartIndex = actions.length;

                    for (const action of getActions()) {
                        actions.push(action);
                    }

                    // When we create a new task that occupies our ghost `TaskId` then we need to
                    // create a task subscription to make sure the store doesn't immediately throw
                    // away the data.
                    //
                    // It's important that this goes before the
                    // `store.commitTaskActionTransaction()` call!
                    const taskSubscription = store.createAndRetainTaskSubscription(taskId);

                    const childrenQuery = store.ensureAndRetainTaskChildrenQuery(taskId, {
                        limit: getTaskGridViewLoadQueryLimit(clientInfo),
                    });

                    store.loadTasksIntoQuery(childrenQuery, {
                        limit: 0,
                        loadedState: {type: "Full"},
                        previouslyBackfilledTaskIds: [],
                    });

                    // Hold our new subscriptions long enough for the `useEffect()` in this
                    // component to `retain()` them then we can release the reference count for
                    // this function.
                    setTimeout(() => {
                        taskSubscription.release();
                        childrenQuery.release();
                    }, unknownTaskQueryFromServerRetentionPeriodMs);

                    setNewlyCreatedTaskSubscriptionAndChildrenQuery({
                        taskSubscription,
                        childrenQuery,
                    });

                    const commitPromise = store.commitTaskActionTransaction(context, actions, {
                        undoManager,
                        affinityManager,
                        // Don't undo the create task action or the update assignee action. These
                        // actions are not explicitly performed by the user so it would be strange to
                        // include them in the undo stack.
                        undoableSlice: {startIndex: undoableSliceStartIndex, endIndex: null},
                    });

                    return commitPromise;
                });
            });
        },
    );

    return useInboxBannerOutletContainer(
        {
            initialEntry: inboxEntry,
            maxWidth: "full",
            sidebarRightWidth: taskDetailViewCommentSidebarWidth,
        },
        <TaskDetailAndCommentsView
            // Remount when the `TaskId` changes.
            key={taskId}
            taskId={taskId}
            store={store}
            taskSubscription={taskSubscription}
            childrenQuery={childrenQuery}
            initialChildrenGridViewExpansionState={initialChildrenGridViewExpansionState}
            initialFields={initialFieldsModel}
            initialIsFavorite={initialIsFavorite}
            initialNotesVersion={initialNotesVersion}
            initialNotesContent={initialNotesContent}
            commitActionTransactionAndCreateIfNeeded={commitActionTransactionAndCreateIfNeeded}
            affinityManager={affinityManager}
            shouldInitiallyFocus={shouldInitiallyFocus}
            showComments={showComments && routeLayout !== "narrow"}
            onShowCommentsChange={setShowComments}
            initialComments={initialComments}
            initialScrollToCommentIndex={initialScrollToCommentIndex}
        />,
    );
}

function pushTaskQueryNormalizedFiltersInitialFieldsActions(
    timeZone: TimeZone,
    currentAccountId: AccountId,
    clock: HybridLogicalClock,
    taskId: TaskId,
    initialFields: TaskQueryNormalizedFiltersInitialFieldsModel,
    actions: Array<TaskActionModel>,
) {
    switch (initialFields.status) {
        case "Open":
            break;
        case "Closed": {
            const time = clock.now();

            actions.push({
                type: "UpdateTask",
                time,
                taskId,
                taskAction: {
                    type: "UpdateStatus",
                    status: {
                        type: "Closed",
                        closerId: currentAccountId,
                        closedTime: new TaskFilterableTime({
                            absoluteTime: time,
                            setterTimeZone: timeZone,
                        }),
                    },
                },
            });
            break;
        }
        default:
            throw exhaustive(initialFields.status);
    }

    if (initialFields.assignee !== null) {
        const time = clock.now();

        actions.push({
            type: "UpdateTask",
            time,
            taskId,
            taskAction: {
                type: "UpdateAssignee",
                assignee: {
                    assigneeId: initialFields.assignee.id,
                    assignerId: currentAccountId,
                    assignedTime: new TaskFilterableTime({
                        absoluteTime: time,
                        setterTimeZone: timeZone,
                    }),
                },
            },
        });
    }

    switch (initialFields.assigneeStatus) {
        case "Inactive":
            break;
        case "Active": {
            const time = clock.now();

            actions.push({
                type: "UpdateTask",
                time,
                taskId,
                taskAction: {
                    type: "UpdateAssigneeStatus",
                    assigneeStatus: {
                        type: "Active",
                        activatedTime: new TaskFilterableTime({
                            absoluteTime: time,
                            setterTimeZone: timeZone,
                        }),
                    },
                },
            });
            break;
        }
        default:
            throw exhaustive(initialFields.assigneeStatus);
    }

    const collectionOrderKeys = generateOrderKeysBetween(
        null,
        null,
        initialFields.collectionIds.size,
    );

    for (const [collectionId, collectionIndex] of iterableWithIndex(initialFields.collectionIds)) {
        const time = clock.now();

        actions.push({
            type: "UpdateTask",
            time,
            taskId,
            taskAction: {
                type: "AddCollection",
                collectionId,
                orderKey: collectionOrderKeys[collectionIndex]!,
            },
        });
    }

    if (initialFields.priority !== null) {
        const time = clock.now();

        actions.push({
            type: "UpdateTask",
            time,
            taskId,
            taskAction: {
                type: "UpdatePriority",
                priority: initialFields.priority,
            },
        });
    }

    if (initialFields.dueDate !== null) {
        const time = clock.now();

        actions.push({
            type: "UpdateTask",
            time,
            taskId,
            taskAction: {
                type: "UpdateDueDate",
                dueDate: initialFields.dueDate,
            },
        });
    }

    if (initialFields.titleUpdate !== null) {
        const time = clock.now();

        actions.push({
            type: "UpdateTask",
            time,
            taskId,
            taskAction: {
                type: "UpdateTitle",
                titleUpdate: initialFields.titleUpdate,
            },
        });
    }
}
