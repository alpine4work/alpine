import {parseAbsolute, toCalendarDate} from "@internationalized/date";
import {useEffect, useMemo, useRef, useState} from "react";
import {flushSync} from "react-dom";
import {ShouldRevalidateFunction, useParams} from "react-router";
import {useSearchParams} from "react-router-dom";
import {createHeadMetaForTask} from "~/app/helpers/create_head_meta.js";
import {
    deserializeSpaceIdForLoader,
    deserializeTaskIdForLoader,
} from "~/app/helpers/deserialize_id_for_loader.js";
import {loadWithSpaceAndSiteDiscovery} from "~/app/helpers/load_with_space_and_site_discovery.js";
import {useTaskClientStoreSearchAffinityManager} from "~/app/helpers/use_task_client_store_search_entity_affinity_manager.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {useHintOracle} from "~/client/web/design/use_hint_oracle.js";
import {useEvent} from "~/client/web/helpers/lifecycle/use_event.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {useInboxBannerOutletContainer} from "~/client/web/inbox/use_inbox_banner_outlet_container.js";
import {getInitialLoadMessageCount} from "~/client/web/messaging/get_initial_load_message_count.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {createMetaFunction} from "~/client/web/remix/create_meta_function.js";
import {usePeekContext} from "~/client/web/remix/peek_context.js";
import {useRouteLayout} from "~/client/web/remix/route_layout_context.js";
import {
    getCurrentDate,
    useCurrentDate,
} from "~/client/web/remix/use_current_time_rounded_to_hour.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {metaTitlePostfix, useUpdateMetaTitle} from "~/client/web/remix/use_update_meta_title.js";
import {useSiteChromeContainer} from "~/client/web/sites/use_site_chrome_container.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {disableTaskGridViewAnimationsForTaskIdUntilNextBrowserPaint} from "~/client/web/tasks/core/disable_task_grid_view_animations_until_next_browser_paint.js";
import {TaskClientQuery} from "~/client/web/tasks/core/task_client_query.js";
import {
    TaskClientStoreSearchAffinityManager,
    TaskClientStoreUndoManager,
} from "~/client/web/tasks/core/task_client_store.js";
import {TaskClientTaskSubscription} from "~/client/web/tasks/core/task_client_task_subscription.js";
import {TaskQueryNormalizedFiltersInitialFieldsModel} from "~/client/web/tasks/core/task_query_normalized_filters_initial_fields_model.js";
import {unknownTaskQueryFromServerRetentionPeriodMs} from "~/client/web/tasks/core/task_realtime_client.js";
import {useTaskStoreLoaderDataWithoutRetaining} from "~/client/web/tasks/core/task_realtime_client_context_provider.js";
import {getTaskGridViewLoadQueryLimit} from "~/client/web/tasks/get_task_grid_view_load_query_limit.js";
import {normalizeTaskDetailViewQuery} from "~/client/web/tasks/normalize_task_detail_view_query.js";
import {TaskDetailView} from "~/client/web/tasks/task_detail_view.js";
import {taskDetailViewLoadMoreChildTasksLimit} from "~/client/web/tasks/task_detail_view_load_more_child_tasks_limit.js";
import {TaskGridViewDndContext} from "~/client/web/tasks/task_grid_view_dnd_context.js";
import {getInboxEntry} from "~/server/notifications/data/get_inbox_entry.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {isSearchFavoriteEntity} from "~/server/search/data/table/search_entity_actions.js";
import {authorizeSpaceAccessIfPossible} from "~/server/spaces/authorize_space_access.js";
import {getAccount} from "~/server/spaces/get_account.js";
import {getTaskNotesContentAndOptionalInitialCommentsIfExists} from "~/server/tasks/data/get_task_notes_content_and_optional_initial_comments_if_exists.js";
import {getTaskQueryFilterReferences} from "~/server/tasks/data/get_task_query_filter_references.js";
import {ShareNotification} from "~/shared/access/share_notification.js";
import {getOpenGraphContent} from "~/shared/content/open_graph_content.js";
import {createRynamoItemSchema} from "~/shared/dynamo/rynamo_types.js";
import {InternalError, InvalidArgumentError, NotFoundError} from "~/shared/error/error.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {HybridLogicalClock} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.js";
import {captureResultPromise} from "~/shared/helpers/control/capture_result_promise.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {throwError} from "~/shared/helpers/control/throw_error.js";
import {roundDateToHour} from "~/shared/helpers/date/round_date_to_hour.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.js";
import {iterableWithIndex} from "~/shared/helpers/iterable/iterable_with_index.js";
import {emptySet} from "~/shared/helpers/set/empty_set.js";
import {generateOrderKeysBetween} from "~/shared/helpers/sort/order_key.js";
import {generateId, isId} from "~/shared/id/id.js";
import {AccountId, BrowserId, SpaceId, TaskId} from "~/shared/id/types/id_types.js";
import {InboxEntryModelSchema} from "~/shared/notifications/inbox_model.js";
import {Schema} from "~/shared/schema/schema.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {batchStoreUpdates} from "~/shared/store/batch_store_updates.js";
import {ConstStore} from "~/shared/store/const_store.js";
import {TaskActionModel} from "~/shared/tasks/actions/task_action_model.js";
import {TaskCommentModel} from "~/shared/tasks/model/task_comment_model.js";
import {createTaskNotFoundError} from "~/shared/tasks/task_error_messages.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";
import {TaskGridViewExpansionStateSchema} from "~/shared/tasks/task_grid_view_expansion_state.js";
import {
    TaskNotesContentWithReferencesSchema,
    emptyTaskNotesContentWithReferences,
} from "~/shared/tasks/task_notes_content_schema.js";
import {
    deserializeTaskQueryFiltersSearchParam,
    serializeTaskQueryFiltersSearchParam,
} from "~/shared/tasks/task_query_filter.js";
import {TaskQueryFilterReferencesSchema} from "~/shared/tasks/task_query_filter_references.js";
import {
    TaskQueryNormalizedFilters,
    normalizeTaskQueryFilters,
} from "~/shared/tasks/task_query_normalized_filters.js";
import {
    TaskQueryNormalizedFiltersInitialFields,
    getTaskQueryNormalizedFiltersInitialFields,
} from "~/shared/tasks/task_query_normalized_filters_initial_fields.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";
import {
    deserializeTaskQuerySortsSearchParam,
    serializeTaskQuerySortsSearchParam,
} from "~/shared/tasks/task_query_sort.js";
import {TaskRealtimeUpdateEventBackfillTask} from "~/shared/tasks/task_realtime_protocol.js";
import {TaskRealtimeLoadQueriesOutput} from "~/shared/tasks/task_realtime_service_procedure_schemas.js";
import {addFallbackToTaskTitle, emptyTaskTitleModel} from "~/shared/tasks/title/task_title.js";
import {
    ServerSynchronizationCheckpointSchema,
    generateServerSynchronizationCheckpoint,
} from "~/shared/web_socket/server_synchronization_checkpoint.js";

const LoaderSchema = Schema.object({
    key: Schema.id(),
    spaceId: Schema.id<SpaceId>(),
    initialMetaTitleText: Schema.string,
    hasUrlGrant: Schema.boolean,
    childrenGridViewExpansionState: TaskGridViewExpansionStateSchema,
    notesVersion: Schema.integer,
    notesContent: TaskNotesContentWithReferencesSchema,
    initialComments: Schema.object({
        checkpoint: ServerSynchronizationCheckpointSchema,
        commentCount: Schema.integer,
        comments: Schema.array(TaskCommentModel.schema()),
        otherReferencedComments: Schema.array(TaskCommentModel.schema()),
    }),
    inboxEntry: createRynamoItemSchema(InboxEntryModelSchema).nullable(),
    isFavorite: Schema.boolean,
    initialFieldsAssignee: AccountModel.schema.nullable(),
    filterReferences: TaskQueryFilterReferencesSchema,
});

function parseTaskCreateSearchParam(createSearchParam: string): {
    spaceId: SpaceId;
    filtersSearchParam: string;
    parentTaskId: string;
} {
    const spaceIdSeparatorIndex = createSearchParam.indexOf(" ");
    const spaceIdString =
        spaceIdSeparatorIndex === -1
            ? createSearchParam
            : createSearchParam.slice(0, spaceIdSeparatorIndex);
    const rest =
        spaceIdSeparatorIndex === -1 ? "" : createSearchParam.slice(spaceIdSeparatorIndex + 1);
    const parentTaskIdSeparatorIndex = rest.indexOf(" ");

    return {
        spaceId: deserializeSpaceIdForLoader(spaceIdString),
        filtersSearchParam:
            parentTaskIdSeparatorIndex === -1 ? rest : rest.slice(0, parentTaskIdSeparatorIndex),
        parentTaskId:
            parentTaskIdSeparatorIndex === -1 ? "" : rest.slice(parentTaskIdSeparatorIndex + 1),
    };
}

export const meta = createMetaFunction(
    LoaderSchema,
    ({data: {initialMetaTitleText, hasUrlGrant, notesContent}}) => {
        const title = addFallbackToTaskTitle(initialMetaTitleText);
        return createHeadMetaForTask({
            title,
            openGraph: hasUrlGrant ? getOpenGraphContent(initialMetaTitleText, notesContent) : null,
        });
    },
);

export async function loader({params, context: unauthenticatedContext, request}: LoaderArgs) {
    const context = await unauthenticatedContext.actor.authenticate();
    const taskId = deserializeTaskIdForLoader(params.taskId);

    const url = new URL(request.url);

    const createSearchParamString = url.searchParams.get("create");
    const createSearchParam =
        createSearchParamString !== null
            ? parseTaskCreateSearchParam(createSearchParamString)
            : null;
    if (createSearchParam !== null) context.discovery.discoverSpaceId(createSearchParam.spaceId);
    const isCreatingTask = createSearchParamString !== null;
    const showInboxEntry = url.searchParams.get("inbox") === "show";

    let initialFields: TaskQueryNormalizedFiltersInitialFields | null = null;
    if (createSearchParam && createSearchParam.filtersSearchParam.length > 0) {
        const initialTime = context.loader.getInitialTime();

        const currentTimeRoundedToHour = roundDateToHour(initialTime);
        const currentDate = toCalendarDate(
            parseAbsolute(
                currentTimeRoundedToHour.toISOString(),
                context.loader.getClientInfo().timeZone,
            ),
        );

        const filters = deserializeTaskQueryFiltersSearchParam(
            createSearchParam.filtersSearchParam,
        );

        const normalizedFiltersResult = normalizeTaskQueryFilters(filters, {
            currentDate,
            currentAccountId:
                context.actor.type === "Session" ? context.actor.getAccountId() : null,
        });
        if (normalizedFiltersResult.type === "Possible") {
            let normalizedFilters = normalizedFiltersResult.normalizedFilters;

            if (createSearchParam.parentTaskId.length > 0) {
                if (!isId<TaskId>(createSearchParam.parentTaskId)) {
                    throw new InvalidArgumentError("Invalid parent `TaskId`");
                }

                // The initial `parentTaskId` should never equal `taskId`. This lets us check the
                // returned `taskSubscription`'s `TaskId` to know whether it's the route task or
                // the initial field parent task.
                if (createSearchParam.parentTaskId === taskId) {
                    throw new InvalidArgumentError(
                        "Can\u2019t set parent task to own `TaskId` (that creates a cycle)",
                    );
                }

                normalizedFilters = {
                    ...normalizedFilters,
                    parentFilter: {parentTaskId: createSearchParam.parentTaskId},
                };
            }

            initialFields = getTaskQueryNormalizedFiltersInitialFields(normalizedFilters, {
                currentDate,
                currentAccountId:
                    context.actor.type === "Session" ? context.actor.getAccountId() : null,
            });
        }
    }

    // `filter`/`sort` with `create` doesn't have an effect since a ghost task we're
    // creating won't have any subtasks. These `filter`/`sort` params are for subtasks
    // so they don't change `initialFields`.
    const filtersString = url.searchParams.get("filter");
    const filters = filtersString ? deserializeTaskQueryFiltersSearchParam(filtersString) : [];
    const sortsString = url.searchParams.get("sort");
    const sorts = sortsString ? deserializeTaskQuerySortsSearchParam(sortsString) : [];

    const {normalizedFiltersResult, normalizedSorts} = normalizeTaskDetailViewQuery(
        taskId,
        filters,
        sorts,
        {
            currentDate: getCurrentDate(context),
            currentAccountId:
                context.actor.type === "Session" ? context.actor.getAccountId() : null,
        },
    );

    const {
        data1: task,
        data2: [
            spaceId,
            childrenQuery,
            loadQueriesOutputResult,
            inboxEntry,
            isFavorite,
            initialFieldsAssignee,
            initialFieldsLoadQueriesOutput,
            filterReferences,
        ] = throwError(new InternalError("Expected `SpaceId` to be discovered")),
        siteLoaderData,
    } = await loadWithSpaceAndSiteDiscovery(context, {
        request,
        entityId: `Task:${taskId}`,
        load1: async ({onSiteId}) => {
            return await getTaskNotesContentAndOptionalInitialCommentsIfExists(context, {
                taskId,
                commentsLimit: getInitialLoadMessageCount(context.loader.getClientInfo()),
                onSiteId,
            }).then(task => {
                if (!task && !isCreatingTask) throw createTaskNotFoundError(taskId);
                return task;
            });
        },
        load2: async ({spaceId}) => {
            const isSpaceAccessAuthorized = (await authorizeSpaceAccessIfPossible(context, spaceId))
                .ok;

            const childrenQuery: {
                limit: number;
                filters: TaskQueryNormalizedFilters;
                sorts: ReadonlyArray<TaskQueryNormalizedSort>;
                shouldLoadGridViewExpandedChildTasksForBrowserId?: BrowserId;
            } | null =
                normalizedFiltersResult.type === "Possible"
                    ? {
                          limit: taskDetailViewLoadMoreChildTasksLimit,
                          filters: normalizedFiltersResult.normalizedFilters,
                          sorts: normalizedSorts,

                          // We only store grid view expansion state for accounts with space access.
                          shouldLoadGridViewExpandedChildTasksForBrowserId: isSpaceAccessAuthorized
                              ? context.loader.getBrowserId()
                              : undefined,
                      }
                    : null;

            return await runAllPromises([
                spaceId,
                childrenQuery,
                captureResultPromise(
                    context.tasks.loadQueries(spaceId, {
                        queries: childrenQuery ? [childrenQuery] : [],
                        taskIds: [taskId],
                        collectionIds: [],
                    }),
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
                initialFields?.assigneeId
                    ? getAccount(context, spaceId, initialFields.assigneeId)
                    : null,
                initialFields &&
                (initialFields.parentTaskId || initialFields.collectionIds.size > 0)
                    ? context.tasks.loadQueries(spaceId, {
                          queries: [],
                          taskIds: initialFields.parentTaskId ? [initialFields.parentTaskId] : [],
                          collectionIds: Array.from(initialFields.collectionIds),
                      })
                    : null,

                getTaskQueryFilterReferences(context, spaceId, filters),
            ]);
        },
    });

    let loadQueriesOutput: TaskRealtimeLoadQueriesOutput | null;

    if (!isCreatingTask) {
        if (!task) throw createTaskNotFoundError(taskId);
        loadQueriesOutput = unwrapResult(loadQueriesOutputResult);
    } else {
        if (loadQueriesOutputResult.ok) {
            loadQueriesOutput = loadQueriesOutputResult.value;
        }
        // If the `create` search param is set, the task doesn't exist, and `loadQueries()`
        // throws a `NotFoundError` then ignore the error since we're ok rendering an empty
        // task we create later.
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

    // Compute Open Graph metadata server-side since content reference resolution is
    // server-only.
    const accessPolicy = backfillTask?.task.getAccessPolicy();

    let taskHasUrlGrant: boolean;
    if (!accessPolicy) {
        taskHasUrlGrant = false;
    } else {
        switch (accessPolicy.type) {
            case "Local": {
                taskHasUrlGrant = accessPolicy.urlGrant !== null;
                break;
            }
            case "Site": {
                const siteResult = loadQueriesOutput?.updateEvent.referencedSites.find(
                    site => site.ok && site.value.id === accessPolicy.siteId,
                );

                assert(siteResult && siteResult.ok);
                taskHasUrlGrant =
                    assertExists(siteResult.value).initialData.accessPolicy.urlGrant !== null;
                break;
            }
            default:
                throw exhaustive(accessPolicy);
        }
    }

    return jsonWithSchema(
        LoaderSchema,
        {
            key: generateId(),
            spaceId,
            initialMetaTitleText: backfillTask?.task.getTitle().getText() ?? "",
            hasUrlGrant: taskHasUrlGrant,
            childrenGridViewExpansionState:
                loadQueriesOutput?.queries[0]?.gridViewExpansionState ?? null,
            notesVersion: task?.notes.version ?? 0,
            notesContent: task?.notes.content ?? emptyTaskNotesContentWithReferences,
            initialComments: task?.initialComments ?? {
                checkpoint: generateServerSynchronizationCheckpoint(),
                commentCount: 0,
                comments: emptyArray,
                otherReferencedComments: emptyArray,
            },
            inboxEntry,
            isFavorite,
            initialFieldsAssignee,
            filterReferences,
        },
        {
            siteLoaderData,
            taskStoreLoaderData: loadQueriesOutput
                ? {
                      queries: childrenQuery
                          ? [
                                {
                                    limit: childrenQuery.limit,
                                    filters: childrenQuery.filters,
                                    sorts: childrenQuery.sorts,
                                    loadedState: assertExists(loadQueriesOutput.queries[0])
                                        .loadedState,
                                },
                                ...loadQueriesOutput.extraQueries,
                            ]
                          : [],
                      taskIds: [taskId],
                      collectionIds: [],
                      updateEvent: loadQueriesOutput.updateEvent,
                  }
                : initialFields &&
                    (initialFields.parentTaskId || initialFields.collectionIds.size > 0)
                  ? {
                        queries: [],
                        taskIds: initialFields.parentTaskId ? [initialFields.parentTaskId] : [],
                        collectionIds: Array.from(initialFields.collectionIds),
                        updateEvent: assertExists(initialFieldsLoadQueriesOutput).updateEvent,
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

    return nextUrl.toString() !== currentUrl.toString();
};

export default function TaskRoute() {
    const {key} = useLoaderDataWithSchema(LoaderSchema);
    const {taskId} = useParams();
    assert(taskId && isId<TaskId>(taskId));

    return useSiteChromeContainer(
        {entityId: `Task:${taskId}`},
        <TaskRouteInner
            // Completely re-mount the route when we get new data from the server.
            key={key}
        />,
    );
}

function TaskRouteInner() {
    const clientInfo = useClientInfo();
    const context = useAppContext();
    const routeLayout = useRouteLayout();
    const {currentAccount, currentAccountSettings, updateCurrentAccountSettings} =
        useSpaceContext();
    const currentDate = useCurrentDate();
    const {taskId} = useParams();
    const [searchParams, setSearchParams] = useSearchParams();
    assert(taskId && isId<TaskId>(taskId));

    const createSearchParam = searchParams.get("create");

    // Remember if the component was being created when we mounted.
    const [wasCreating] = useState(createSearchParam !== null);

    const [shouldInitiallyFocus] = useState(searchParams.get("focus") === "");

    const {
        childrenGridViewExpansionState: initialChildrenGridViewExpansionState,
        notesVersion: initialNotesVersion,
        notesContent: initialNotesContent,
        initialComments,
        inboxEntry,
        isFavorite: initialIsFavorite,
        initialFieldsAssignee,
        filterReferences: initialFilterReferences,
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

    // If we get a children query or task subscription from the server then null out
    // the newly created children query and task subscription.
    if (
        newlyCreatedTaskSubscriptionAndChildrenQuery &&
        (childrenQueryFromLoader || taskSubscriptionFromLoader?.taskId === taskId)
    ) {
        setNewlyCreatedTaskSubscriptionAndChildrenQuery(null);
    }

    const taskSubscription =
        // The task subscription from `loader` may be for the initial parent task field if
        // we're creating a new task with a parent.
        (taskSubscriptionFromLoader?.taskId === taskId ? taskSubscriptionFromLoader : null) ??
        newlyCreatedTaskSubscriptionAndChildrenQuery?.taskSubscription ??
        null;
    const childrenQuery =
        childrenQueryFromLoader ??
        newlyCreatedTaskSubscriptionAndChildrenQuery?.childrenQuery ??
        null;

    // Retain our `taskSubscription` so it isn't destroyed while we're using it. But we
    // don't retain `childrenQuery`! Instead `childrenQuery` is retained by
    // `<TaskDetailview>`. That way when the query changes we can release the query and
    // retain a new one.
    useEffect(() => {
        taskSubscription?.retain();

        return () => {
            // Release after a microtask in case the component is re-rendering which will
            // synchronously call `retain()` again.
            scheduleMicrotask(() => {
                taskSubscription?.release();
            });
        };
    }, [taskSubscription]);

    const [initialFilters] = useState(() => {
        const filtersString = searchParams.get("filter");
        if (!filtersString) return [];
        return deserializeTaskQueryFiltersSearchParam(filtersString);
    });

    const [initialSorts] = useState(() => {
        const sortsString = searchParams.get("sort");
        if (!sortsString) return [];
        return deserializeTaskQuerySortsSearchParam(sortsString);
    });

    // Remove the `create` search param.
    useEffect(() => {
        if ((childrenQuery || taskSubscription) && searchParams.has("create")) {
            setSearchParams(
                oldSearchParams => {
                    const newSearchParams = new URLSearchParams(oldSearchParams);
                    newSearchParams.delete("create");
                    return newSearchParams;
                },
                {replace: true},
            );
        }
    }, [childrenQuery, searchParams, setSearchParams, taskSubscription]);

    // Remove the `focus` search param.
    useEffect(() => {
        if (searchParams.has("focus")) {
            setSearchParams(
                oldSearchParams => {
                    const newSearchParams = new URLSearchParams(oldSearchParams);
                    newSearchParams.delete("focus");
                    return newSearchParams;
                },
                {replace: true},
            );
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

    const defaultInitialFields = useMemo(
        (): TaskQueryNormalizedFiltersInitialFields => ({
            parentTaskId: null,
            status: "Open",
            collectionIds: emptySet,
            priority: null,
            layout: null,
            title: "",
            assigneeId: currentAccount?.id ?? null,
            assigneeStatus: "Inactive",
            dueDate: null,
        }),
        [currentAccount?.id],
    );

    const initialFields = useMemo((): TaskQueryNormalizedFiltersInitialFields => {
        // By default, if initial fields weren't specified then we set the `assigneeId` to
        // the current account and that's it.
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

        const createTaskSearchParam = parseTaskCreateSearchParam(createSearchParam);
        if (
            createTaskSearchParam.filtersSearchParam.length === 0 &&
            createTaskSearchParam.parentTaskId.length === 0
        ) {
            return defaultInitialFields;
        }

        const filters = deserializeTaskQueryFiltersSearchParam(
            createTaskSearchParam.filtersSearchParam,
        );

        const normalizedFiltersResult = normalizeTaskQueryFilters(filters, {
            currentDate,
            currentAccountId: currentAccount?.id ?? null,
        });
        if (normalizedFiltersResult.type === "Impossible") return defaultInitialFields;

        let normalizedFilters = normalizedFiltersResult.normalizedFilters;

        if (createTaskSearchParam.parentTaskId.length > 0) {
            if (!isId<TaskId>(createTaskSearchParam.parentTaskId)) {
                throw new InvalidArgumentError("Invalid parent `TaskId`");
            }

            normalizedFilters = {
                ...normalizedFilters,
                parentFilter: {parentTaskId: createTaskSearchParam.parentTaskId},
            };
        }

        return getTaskQueryNormalizedFiltersInitialFields(normalizedFilters, {
            currentDate,
            currentAccountId: currentAccount?.id ?? null,
        });
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

    // Retain the collection subscriptions from `initialFields.collectionIds` and
    // parent task subscription from `initialFields.parentTaskId`. So we keep those
    // collections/task up-to-date in realtime.
    useEffect(() => {
        if (initialFields.parentTaskId) {
            assert(taskSubscriptionFromLoader?.taskId === initialFields.parentTaskId);
            taskSubscriptionFromLoader.retain();
        }

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
                batchStoreUpdates(() => {
                    if (initialFields.parentTaskId) {
                        assert(taskSubscriptionFromLoader?.taskId === initialFields.parentTaskId);
                        taskSubscriptionFromLoader.release();
                    }

                    for (const collectionId of initialFields.collectionIds) {
                        const collectionSubscription = assertExists(
                            initialFieldsCollectionSubscriptionById.get(collectionId),
                        );

                        collectionSubscription.release();
                    }
                });
            });
        };
    }, [
        initialFields.collectionIds,
        initialFields.parentTaskId,
        initialFieldsCollectionSubscriptionById,
        taskSubscriptionFromLoader,
    ]);

    const initialFieldsModel = useMemo((): TaskQueryNormalizedFiltersInitialFieldsModel => {
        return {
            // We assert the `taskSubscriptionFromLoader` `TaskId` is correct in the above
            // `useEffect()`.
            parentTaskSubscription: initialFields.parentTaskId ? taskSubscriptionFromLoader : null,
            status: initialFields.status,
            // We assert the `initialFieldsCollectionSubscriptionById` `TaskCollectionId`s are
            // correct in the above `useEffect()`.
            collectionSubscriptionById: initialFieldsCollectionSubscriptionById,
            priority: initialFields.priority,
            layout: initialFields.layout,
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
        initialFields.dueDate,
        initialFields.layout,
        initialFields.parentTaskId,
        initialFields.priority,
        initialFields.status,
        initialFields.title,
        initialFieldsAssignee,
        initialFieldsCollectionSubscriptionById,
        taskSubscriptionFromLoader,
    ]);

    const peekContext = usePeekContext();

    // Show the auto save hint once the user has typed something in a task and we've
    // established a `taskSubscription` (confirming the task was created on the
    // backend).
    const isPeekStackAutoSaveHintVisible = useHintOracle(
        peekContext?.stack &&
            wasCreating &&
            taskSubscription &&
            currentAccountSettings.taskPeekStackAutoSaveHint
            ? "a2#TaskPeekStackAutoSaveHint"
            : null,
    );

    const lastIsPeekStackAutoSaveHintVisibleRef = useRef(isPeekStackAutoSaveHintVisible);
    useEffect(() => {
        if (lastIsPeekStackAutoSaveHintVisibleRef.current === isPeekStackAutoSaveHintVisible)
            return;
        lastIsPeekStackAutoSaveHintVisibleRef.current = isPeekStackAutoSaveHintVisible;

        if (isPeekStackAutoSaveHintVisible) {
            // `isPeekStackAutoSaveHintVisible` should only be true if `peekContext.stack`
            // exists.
            assertExists(peekContext?.stack).showTaskAutoSaveHint();
        }
    }, [isPeekStackAutoSaveHintVisible, peekContext?.stack]);

    const commitActionTransactionAndCreateIfNeeded = useEvent(
        (
            getActions: () => Iterable<TaskActionModel>,
            {
                undoManager,
                affinityManager,
                updateAccessPolicyShareNotification = null,
            }: {
                undoManager: TaskClientStoreUndoManager | null;
                affinityManager: TaskClientStoreSearchAffinityManager;
                updateAccessPolicyShareNotification?: ShareNotification | null;
            },
        ): {
            finally: (callback: () => void) => void;
        } => {
            if (taskSubscription) {
                return store.commitTaskActionTransaction(context, getActions(), {
                    undoManager,
                    affinityManager,
                    updateAccessPolicyShareNotification:
                        updateAccessPolicyShareNotification ?? undefined,
                });
            }

            // Currently, accounts without space access can't edit tasks. The max permission
            // level of `urlGrant` is `View`.
            assert(currentAccount);

            // Make sure any state update from the `onGhostTaskCreated` callback runs in the
            // same React commit as our store updates (which use `useSyncExternalStore()`).
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
                                creator: {accountId: currentAccount.id, from: null},
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
                    // create a task subscription to make sure the store doesn't immediately throw away
                    // the data.
                    //
                    // It's important that this goes before the `store.commitTaskActionTransaction()`
                    // call!
                    const taskSubscription = store.createAndRetainTaskSubscription(taskId);

                    const childrenQuery = store.ensureAndRetainTaskChildrenQuery(taskId, {
                        limit: getTaskGridViewLoadQueryLimit(clientInfo),
                    });

                    store.loadTasksIntoQuery(childrenQuery, {
                        limit: 0,
                        loadedState: {type: "Full"},
                        previouslyBackfilledTaskIds: [],
                    });

                    // Hold our new subscriptions long enough for the `useEffect()` in this component
                    // to `retain()` them then we can release the reference count for this function.
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
                        // Don't undo the create task action or the update assignee action. These actions
                        // are not explicitly performed by the user so it would be strange to include them
                        // in the undo stack.
                        undoableSlice: {startIndex: undoableSliceStartIndex, endIndex: null},
                        updateAccessPolicyShareNotification:
                            updateAccessPolicyShareNotification ?? undefined,
                    });

                    return commitPromise;
                });
            });
        },
    );

    const layout = useStore(
        useMemo(
            () =>
                taskSubscription
                    ? taskSubscription.taskEntryStore.map(({task}) => task?.getLayout() ?? null)
                    : new ConstStore(initialFields.layout),
            [initialFields.layout, taskSubscription],
        ),
    );

    // Only show the share activation hint on a project the user created on desktop
    // when they haven't seen the share activation hint before.
    const willShareActivationHintBeVisible =
        wasCreating &&
        routeLayout === "wide" &&
        layout === "Project" &&
        currentAccountSettings.shareActivationHint;

    const [isShareActivationHintVisible, setIsShareActivationHintVisible] = useState(false);

    // Once the share hint is dismissed, stop showing the hint.
    if (isShareActivationHintVisible && !willShareActivationHintBeVisible) {
        setIsShareActivationHintVisible(false);
    }

    const affinityManager = useTaskClientStoreSearchAffinityManager(
        taskSubscription ? `Task:${taskId}` : null,
        {
            onMarkLowIntentUpdateInteraction: useEvent(count => {
                // Show the share hint after 24 seconds of editing. It doesn't have to be 24
                // seconds of continuous editing. Could be one edit, then wait 24 seconds, then
                // another edit. As of 2025-03-19
                // `markSearchAffinityLowIntentUpdateEntityInteraction()` is configured to record
                // affinity points every 24 seconds.
                if (willShareActivationHintBeVisible && count >= 2) {
                    setIsShareActivationHintVisible(true);
                }
            }),
        },
    );

    return useInboxBannerOutletContainer(
        {
            initialEntry: inboxEntry,
            maxWidth: "full",
        },
        <TaskGridViewDndContext store={store}>
            <TaskDetailView
                // Remount when the `TaskId` changes.
                key={taskId}
                taskId={taskId}
                store={store}
                taskSubscription={taskSubscription}
                layout={layout}
                initialChildrenQuery={
                    childrenQuery
                        ? {
                              query: childrenQuery,
                              initialGridViewExpansionState: initialChildrenGridViewExpansionState,
                          }
                        : null
                }
                initialFilters={initialFilters}
                initialFilterReferences={initialFilterReferences}
                initialSorts={initialSorts}
                onFiltersChange={filters => {
                    const newSearchParams = new URLSearchParams(searchParams);

                    if (filters.length === 0) {
                        newSearchParams.delete("filter");
                    } else {
                        newSearchParams.set(
                            "filter",
                            serializeTaskQueryFiltersSearchParam(filters),
                        );
                    }

                    setSearchParams(newSearchParams, {
                        replace: true,
                        // Don't revalidate when updating search params from here. We can't use the stable
                        // `shouldRevalidate` route function because if the user navigates to a new URL we
                        // want to load new data and re-render the route.
                        unstable_shouldRevalidate: false,
                    });
                }}
                onSortsChange={sorts => {
                    const newSearchParams = new URLSearchParams(searchParams);

                    if (sorts.length === 0) {
                        newSearchParams.delete("sort");
                    } else {
                        newSearchParams.set("sort", serializeTaskQuerySortsSearchParam(sorts));
                    }

                    setSearchParams(newSearchParams, {
                        replace: true,
                        // Don't revalidate when updating search params from here. We can't use the stable
                        // `shouldRevalidate` route function because if the user navigates to a new URL we
                        // want to load new data and re-render the route.
                        unstable_shouldRevalidate: false,
                    });
                }}
                initialFields={initialFieldsModel}
                initialIsFavorite={initialIsFavorite}
                initialNotesVersion={initialNotesVersion}
                initialNotesContent={initialNotesContent}
                commitActionTransactionAndCreateIfNeeded={commitActionTransactionAndCreateIfNeeded}
                affinityManager={affinityManager}
                shouldInitiallyFocus={shouldInitiallyFocus}
                initialComments={initialComments}
                initialScrollToCommentIndex={initialScrollToCommentIndex}
                shareActivationHint={
                    // If we're going to show the share activation hint after some editing we need to
                    // communicate that. So `<ShareButton>` can tell the hint oracle to suppress all
                    // other hints until we're ready to show the share activation hint.
                    willShareActivationHintBeVisible
                        ? {willBeVisible: true, isVisible: isShareActivationHintVisible}
                        : null
                }
                onShareActivationHintHide={() => {
                    updateCurrentAccountSettings({type: "HideShareActivationHint"});
                }}
            />
        </TaskGridViewDndContext>,
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
    if (initialFields.parentTaskSubscription) {
        const time = clock.now();

        actions.push({
            type: "UpdateTask",
            time,
            taskId,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskId: initialFields.parentTaskSubscription.taskId,
            },
        });
    }

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
        initialFields.collectionSubscriptionById.size,
    );

    for (const [collectionId, collectionIndex] of iterableWithIndex(
        initialFields.collectionSubscriptionById.keys(),
    )) {
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

    if (initialFields.layout !== null) {
        const time = clock.now();

        actions.push({
            type: "UpdateTask",
            time,
            taskId,
            taskAction: {
                type: "UpdateLayout",
                layout: initialFields.layout,
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
