import {useEffect, useState} from "react";
import {Params, ShouldRevalidateFunction, useParams} from "react-router";
import {useSearchParams} from "react-router-dom";
import {useAppContext} from "~/client/context/app_context.js";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {createMetaFunction} from "~/client/remix/create_meta_function.js";
import {getCurrentDate} from "~/client/remix/use_current_time_rounded_to_hour.js";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {metaTitlePostfix, useUpdateMetaTitle} from "~/client/remix/use_update_meta_title.js";
import {useSearchEntityAffinityViewInteraction} from "~/client/search/use_search_entity_view_affinity_interaction.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {getTaskGridViewLoadQueryLimit} from "~/client/tasks/get_task_grid_view_load_query_limit.js";
import {TaskClientCollectionSubscription} from "~/client/tasks/task_client_collection_subscription.js";
import {
    TaskCollectionView,
    newTaskCollectionNamePlaceholder,
} from "~/client/tasks/task_collection_view.js";
import {TaskGridViewDndContext} from "~/client/tasks/task_grid_view_dnd_context.js";
import {
    clientLoaderTaskStoreLoaderData,
    useTaskStoreLoaderDataWithoutRetaining,
} from "~/client/tasks/task_realtime_client_context_provider.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {getTaskQueryFilterReferences} from "~/server/tasks/data/get_task_query_filter_references.js";
import {
    authorizeTaskCollectionAccess,
    commitTaskActionTransaction,
} from "~/server/tasks/data/task_table.js";
import {FailedPreconditionError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {MonotonicClock} from "~/shared/helpers/clock/monotonic_clock.js";
import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {generateId, isId} from "~/shared/id/id.js";
import {BrowserId, SpaceId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {addTaskCollectionAffinityPoints} from "~/shared/rpc/tasks_rpc_definitions.js";
import {Schema, SchemaSerializedObjectValue} from "~/shared/schema/schema.js";
import {taskCollectionAffinityPointsPer5MinOfViewingTime} from "~/shared/tasks/task_collection_affinity_constants.js";
import {TaskGridViewExpansionStateSchema} from "~/shared/tasks/task_grid_view_expansion_state.js";
import {
    deserializeTaskQueryFiltersSearchParam,
    serializeTaskQueryFiltersSearchParam,
} from "~/shared/tasks/task_query_filter.js";
import {
    TaskQueryFilterReferencesSchema,
    emptyTaskQueryFilterReferences,
} from "~/shared/tasks/task_query_filter_references.js";
import {
    TaskQueryNormalizedFilters,
    normalizeTaskQueryFilters,
} from "~/shared/tasks/task_query_normalized_filters.js";
import {
    TaskQueryNormalizedSort,
    normalizeTaskQuerySorts,
} from "~/shared/tasks/task_query_normalized_sort.js";
import {
    deserializeTaskQuerySortsSearchParam,
    serializeTaskQuerySortsSearchParam,
} from "~/shared/tasks/task_query_sort.js";
import {TaskRealtimeUpdateEventBackfillCollection} from "~/shared/tasks/task_realtime_protocol.js";

const LoaderSchema = Schema.object({
    key: Schema.id(),
    collectionState: Schema.union({
        NotExists: Schema.object({
            type: Schema.value("NotExists"),
        }),
        Exists: Schema.object({
            type: Schema.value("Exists"),
            initialMetaTitleText: Schema.string,
            initialGridViewExpansionState: TaskGridViewExpansionStateSchema,
            initialBottomGhostTaskId: Schema.id<TaskId>(),
        }),
    }),
    filterReferences: TaskQueryFilterReferencesSchema,
});

export const meta = createMetaFunction(LoaderSchema, ({data: {collectionState}}) => [
    {
        title:
            collectionState.type === "Exists"
                ? collectionState.initialMetaTitleText
                : newTaskCollectionNamePlaceholder,
    },
]);

export async function loader({request, params, context: _context}: LoaderArgs) {
    const context = (await _context.actor.authenticate()).actor.authorizeSession();

    const url = new URL(request.url);
    const spaceId = Schema.id<SpaceId>().deserialize(params.spaceId ?? null);
    const collectionId = Schema.id<TaskCollectionId>().deserialize(params.collectionId ?? null);

    const createSearchParam = url.searchParams.get("create");

    if (createSearchParam === "") {
        return jsonWithSchema(
            LoaderSchema,
            {
                key: generateId(),
                collectionState: {
                    type: "NotExists",
                },
                filterReferences: emptyTaskQueryFilterReferences,
            },
            {
                propagateEventData: {
                    context: {taskCollectionId: collectionId},
                },
            },
        );
    }

    if (createSearchParam !== null) {
        try {
            await commitTaskActionTransaction(context, spaceId, [
                {
                    type: "UpdateCollection",
                    time: [Date.now(), 0],
                    collectionId,
                    collectionAction: {
                        type: "Create",
                        name: createSearchParam,
                        accessPolicy: {
                            accountGrantById: new Map([
                                [context.actor.getAccountId(), {level: "Manage"}],
                            ]),
                            defaultGrant: null,
                        },
                    },
                },
            ]);
        } catch (error) {
            if (!(error instanceof FailedPreconditionError)) {
                throw error;
            }

            // If there was an issue creating our collection, it might be because the
            // collection already exists. Attempt to authorize, if that fails we
            // believe the issue was with collection creation.
            //
            // This check makes this `GET` endpoint idempotent. You can hit the endpoint
            // multiple times and if our collection is already created we'll noop.
            try {
                await authorizeTaskCollectionAccess(context, collectionId, "View", null);
            } catch {
                throw error;
            }
        }
    }

    const filtersString = url.searchParams.get("filter");
    const filters = filtersString ? deserializeTaskQueryFiltersSearchParam(filtersString) : [];
    const sortsString = url.searchParams.get("sort");
    const sorts = sortsString ? deserializeTaskQuerySortsSearchParam(sortsString) : [];

    // Always include collection filter in our list of filters.
    const normalizedFiltersResult = normalizeTaskQueryFilters(
        [
            {
                type: "Collections",
                operation: {type: "IncludesOneOf", collectionIds: new Set([collectionId])},
            },
            ...filters,
        ],
        {
            currentDate: getCurrentDate(context),
            currentAccountId: context.actor.getAccountId(),
        },
    );

    // If no filters or sorts have been explicitly set then the user can manually
    // sort by collection position.
    //
    // If the collection view is filtered we automatically apply a sort since there
    // can be some weirdness creating a task and expecting it to be in one place
    // when there's no filter but instead it goes to another place.
    const normalizedSorts: ReadonlyArray<TaskQueryNormalizedSort> =
        filters.length === 0 && sorts.length === 0
            ? [
                  {
                      type: "CollectionPosition",
                      direction: "Ascending",
                      missing: "Last",
                      collectionId,
                  },
                  {
                      type: "CreatedTime",
                      direction: "Ascending",
                      missing: "Last",
                  },
              ]
            : normalizeTaskQuerySorts(sorts);

    const [filterReferences, loadQueryResult] = await runAllPromises([
        getTaskQueryFilterReferences(context, spaceId, filters),
        (async () => {
            if (normalizedFiltersResult.type !== "Possible") {
                const result = await context.tasks.loadQueries(spaceId, {
                    queries: [],
                    taskIds: [],
                    collectionIds: [collectionId],
                });

                return Object.assign(result, {input: {query: null}});
            }

            const {normalizedFilters} = normalizedFiltersResult;

            const query: {
                limit: number;
                filters: TaskQueryNormalizedFilters;
                sorts: ReadonlyArray<TaskQueryNormalizedSort>;
                shouldLoadGridViewExpandedChildTasksForBrowserId?: BrowserId;
            } = {
                limit: getTaskGridViewLoadQueryLimit(context.loader.getClientInfo()),
                filters: normalizedFilters,
                sorts: normalizedSorts,
                shouldLoadGridViewExpandedChildTasksForBrowserId: context.loader.getBrowserId(),
            };

            const result = await context.tasks.loadQueries(spaceId, {
                queries: [query],
                taskIds: [],
                collectionIds: [collectionId],
            });

            return Object.assign(result, {input: {query}});
        })(),
    ]);

    const backfillCollection = loadQueryResult?.updateEvent.backfillCollections.find(
        (
            backfillCollection,
        ): backfillCollection is TaskRealtimeUpdateEventBackfillCollection & {type: "Authorized"} =>
            backfillCollection.type === "Authorized" &&
            backfillCollection.collection.id === collectionId,
    );
    const queryOutput = loadQueryResult ? assertExists(loadQueryResult.queries[0]) : null;

    return jsonWithSchema(
        LoaderSchema,
        {
            key: generateId(),
            collectionState: {
                type: "Exists",
                initialMetaTitleText: backfillCollection?.collection.getName() ?? "",
                initialGridViewExpansionState: queryOutput?.gridViewExpansionState ?? null,
                initialBottomGhostTaskId: generateId<TaskId>(),
            },
            filterReferences,
        },
        {
            propagateEventData: {
                context: {taskCollectionId: collectionId},
            },
            taskStoreLoaderData: loadQueryResult
                ? {
                      queries: [
                          ...(loadQueryResult.input.query
                              ? [
                                    {
                                        limit: loadQueryResult.input.query.limit,
                                        filters: loadQueryResult.input.query.filters,
                                        sorts: loadQueryResult.input.query.sorts,
                                        loadedState: assertExists(queryOutput).loadedState,
                                    },
                                ]
                              : []),
                          ...loadQueryResult.extraQueries,
                      ],
                      taskIds: [],
                      collectionIds: [collectionId],
                      updateEvent: loadQueryResult.updateEvent,
                  }
                : undefined,
        },
    );
}

export async function clientLoader({
    data,
    params,
}: {
    data: SchemaSerializedObjectValue;
    params: Params<string>;
}) {
    const spaceId = Schema.id<SpaceId>().deserialize(params.spaceId ?? null);

    clientLoaderTaskStoreLoaderData(spaceId, data);
}

export const shouldRevalidate: ShouldRevalidateFunction = ({
    currentUrl: _currentUrl,
    nextUrl: _nextUrl,
    defaultShouldRevalidate,
}) => {
    const currentUrl = new URL(_currentUrl);
    const nextUrl = new URL(_nextUrl);

    // The client removes the `create` search param. Don't revalidate when the
    // client does this.
    if (!nextUrl.searchParams.has("create") && currentUrl.searchParams.has("create")) {
        return false;
    }

    return defaultShouldRevalidate;
};

export default function TaskCollectionRoute() {
    const {key} = useLoaderDataWithSchema(LoaderSchema);

    return (
        <TaskCollectionRouteInner
            // Completely re-mount the route when we get new data from the server.
            key={key}
        />
    );
}

function TaskCollectionRouteInner() {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();

    const {collectionId} = useParams();
    assert(collectionId && isId<TaskCollectionId>(collectionId));

    const {collectionState, filterReferences: initialFilterReferences} =
        useLoaderDataWithSchema(LoaderSchema);
    const {
        store,
        queries: [initialQuery],
        collectionSubscriptions: [collectionSubscription],
    } = useTaskStoreLoaderDataWithoutRetaining({
        searchEntityAffinityIdForLowIntentUpdateInteraction: `TaskCollection:${collectionId}`,
    });

    // Retain our `collectionSubscription` so it isn't destroyed while we're
    // using it. But we don't retain `initialQuery`! Instead `initialQuery` is
    // retained by `<TaskCollectionView>`. That way when the query changes we can
    // release the query and retain a new one.
    useEffect(() => {
        collectionSubscription?.retain();

        return () => {
            // Release after a microtask in case the component is re-rendering which will
            // synchronously call `retain()` again.
            scheduleMicrotask(() => {
                collectionSubscription?.release();
            });
        };
    }, [collectionSubscription]);

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

    // Remove the `create` search param if we have a subscription to an
    // existing collection.
    useEffect(() => {
        if (!collectionSubscription) return;

        if (searchParams.has("create")) {
            const newSearchParams = new URLSearchParams(searchParams);
            newSearchParams.delete("create");
            setSearchParams(newSearchParams, {replace: true});
        }
    }, [collectionSubscription, searchParams, setSearchParams]);

    const updateMetaTitle = useUpdateMetaTitle();

    // Update our document's title whenever the task's title changes.
    useEffect(() => {
        const update = () => {
            const collectionEntryStore = collectionSubscription?.collectionEntryStore;

            updateMetaTitle(
                `${
                    collectionEntryStore
                        ? collectionEntryStore.getSnapshot().collection?.getName() ?? ""
                        : newTaskCollectionNamePlaceholder
                }${metaTitlePostfix}`,
            );
        };

        update();
        return collectionSubscription?.collectionEntryStore.subscribe(update);
    }, [collectionSubscription?.collectionEntryStore, updateMetaTitle]);

    useAddTaskCollectionViewingTimeAffinityPoints(collectionSubscription);

    useSearchEntityAffinityViewInteraction(
        collectionSubscription ? `TaskCollection:${collectionSubscription.collectionId}` : null,
    );

    return (
        <TaskGridViewDndContext store={store}>
            <TaskCollectionView
                store={store}
                collectionId={collectionId}
                collectionSubscription={collectionSubscription ?? null}
                initialQuery={
                    initialQuery && collectionState.type === "Exists"
                        ? {
                              query: initialQuery,
                              initialGridViewExpansionState:
                                  collectionState.initialGridViewExpansionState,
                              initialBottomGhostTaskId: collectionState.initialBottomGhostTaskId,
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
                        // Don't revalidate when updating search params from here. We can't use the
                        // stable `shouldRevalidate` route function because if the user navigates to
                        // a new URL we want to load new data and re-render the route.
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
                        // Don't revalidate when updating search params from here. We can't use the
                        // stable `shouldRevalidate` route function because if the user navigates to
                        // a new URL we want to load new data and re-render the route.
                        unstable_shouldRevalidate: false,
                    });
                }}
                // eslint-disable-next-line @typescript-eslint/no-misused-promises
                createCollection={useEvent(async name => {
                    const newSearchParams = new URLSearchParams(searchParams);
                    newSearchParams.set("create", name);

                    await navigate(
                        `/s/${
                            store.spaceId
                        }/tasks/collections/${collectionId}?${newSearchParams.toString()}`,
                        {replace: true},
                    );
                })}
            />
        </TaskGridViewDndContext>
    );
}

function useAddTaskCollectionViewingTimeAffinityPoints(
    collectionSubscription: TaskClientCollectionSubscription | undefined,
) {
    const context = useAppContext();
    const {space} = useSpaceContext();

    // Every 5min while our collection route is visible we add to the collection's
    // affinity score. We don't add to the affinity scores while the page is
    // hidden. We resume if the user reopens the page.
    useEffect(() => {
        if (!collectionSubscription) return;
        const {collectionId} = collectionSubscription;

        const clock = new MonotonicClock(unsynchronizedSystemClock);

        let state: {
            timeout: Timeout;
            lastUpdatedTime: number;
        } | null = null;

        const update = () => {
            const currentTime = clock.now();

            // Stop our affinity update loop:
            if (document.visibilityState !== "visible" && state) {
                sessionStorage.setItem(
                    `cyberworlds/taskCollectionDurationSinceLastUpdate/${collectionId}`,
                    JSON.stringify(currentTime - state.lastUpdatedTime),
                );
                state.timeout.clear();
                state = null;
            }

            // Start our affinity update loop:
            if (document.visibilityState === "visible" && !state) {
                const durationSinceLastUpdate = JSON.parse(
                    sessionStorage.getItem(
                        `cyberworlds/taskCollectionDurationSinceLastUpdate/${collectionId}`,
                    ) ?? "0",
                );

                const updateIntervalDuration = 1000 * 60 * 5; // 5min

                let updateCount = 0;
                const maxUpdateCount = 12;

                const updateLoop = () => {
                    // If this errs it will show up in our telemetry but we don't care about
                    // it here.
                    void addTaskCollectionAffinityPoints(context, {
                        spaceId: space.id,
                        collectionId,
                        points: taskCollectionAffinityPointsPer5MinOfViewingTime,
                    });

                    // Stop loop after we hit a max number of updates (1hr) to defend against the
                    // user leaving their computer open and unattended for a long time. If the user
                    // is continuously interacting with the page then we'll continue adding points.
                    updateCount++;
                    if (updateCount >= maxUpdateCount) return;

                    state = {
                        lastUpdatedTime: currentTime,
                        timeout: createTimeout(updateLoop, updateIntervalDuration),
                    };
                };

                if (
                    durationSinceLastUpdate <= 0 ||
                    updateIntervalDuration - durationSinceLastUpdate <= 0
                ) {
                    updateLoop();
                } else {
                    state = {
                        lastUpdatedTime: currentTime - durationSinceLastUpdate,
                        timeout: createTimeout(
                            updateLoop,
                            updateIntervalDuration - durationSinceLastUpdate,
                        ),
                    };
                }
            }
        };

        update();

        document.addEventListener("visibilitychange", update);
        return () => {
            document.removeEventListener("visibilitychange", update);

            // If our component unmounts, save the duration since last update in our
            // session storage so we can pick up adding affinity points from there if the
            // user navigates back.
            if (state) {
                const currentTime = clock.now();

                sessionStorage.setItem(
                    `cyberworlds/taskCollectionDurationSinceLastUpdate/${collectionId}`,
                    JSON.stringify(currentTime - state.lastUpdatedTime),
                );
                state.timeout.clear();
                state = null;
            }
        };
    }, [collectionSubscription, context, space.id]);
}
