import {useEffect} from "react";
import {useParams} from "react-router";
import {useSearchParams} from "react-router-dom";
import {useAppContext} from "~/client/context/app_context.js";
import {batchStoreUpdates} from "~/client/helpers/store/batch_store_updates.js";
import {createMetaFunction} from "~/client/remix/create_meta_function.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {getTaskGridViewLoadQueryLimit} from "~/client/tasks/get_task_grid_view_load_query_limit.js";
import {TaskClientCollectionSubscription} from "~/client/tasks/task_client_collection_subscription.js";
import {
    TaskCollectionView,
    newTaskCollectionNamePlaceholder,
} from "~/client/tasks/task_collection_view.js";
import {
    clientLoaderTaskStoreLoaderData,
    useTaskClientStore,
    useTaskStoreLoaderDataWithoutRetaining,
} from "~/client/tasks/task_realtime_client_context_provider.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {
    authorizeTaskCollectionAccess,
    commitTaskActionTransaction,
} from "~/server/tasks/data/task_table.js";
import {FailedPreconditionError} from "~/shared/error/error.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {MonotonicClock} from "~/shared/helpers/clock/monotonic_clock.js";
import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {generateId} from "~/shared/id/id.js";
import {BrowserId, SpaceId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {addTaskCollectionAffinityPoints} from "~/shared/rpc/tasks_rpc_definitions.js";
import {Schema, SchemaSerializedObjectValue} from "~/shared/schema/schema.js";
import {taskCollectionAffinityPointsPer5MinOfViewingTime} from "~/shared/tasks/task_collection_affinity_constants.js";
import {TaskGridViewExpansionStateSchema} from "~/shared/tasks/task_grid_view_expansion_state.js";
import {
    TaskQueryNormalizedFilters,
    assertNonEmptyReadonlyMap,
} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";

const LoaderSchema = Schema.object({
    collectionState: Schema.union({
        NotExists: Schema.object({
            type: Schema.value("NotExists"),
        }),
        Exists: Schema.object({
            type: Schema.value("Exists"),
            initialMetaTitleText: Schema.string,
            childrenGridViewExpansionState: TaskGridViewExpansionStateSchema,
            initialBottomGhostTaskId: Schema.id<TaskId>(),
        }),
    }),
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
                collectionState: {
                    type: "NotExists",
                },
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

    const query: {
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
                ifClosed: false,
            },
            collectionsFilter: [assertNonEmptyReadonlyMap(new Map([[collectionId, false]]))],
        },
        sorts: [
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
        ],

        shouldLoadGridViewExpandedChildTasksForBrowserId: context.loader.getBrowserId(),
    };

    const {queries, extraQueries, updateEvent} = await context.tasks.loadQueries(spaceId, {
        queries: [query],
        taskIds: [],
        collectionIds: [collectionId],
    });

    const collection = updateEvent.backfillAuthorizedCollections.find(
        collection => collection.id === collectionId,
    );
    const queryOutput = assertExists(queries[0]);

    return jsonWithSchema(
        LoaderSchema,
        {
            collectionState: {
                type: "Exists",
                initialMetaTitleText: collection?.getName() ?? "",
                childrenGridViewExpansionState: queryOutput.gridViewExpansionState,
                initialBottomGhostTaskId: generateId<TaskId>(),
            },
        },
        {
            propagateEventData: {
                context: {taskCollectionId: collectionId},
            },
            taskStoreLoaderData: {
                queries: [
                    {
                        limit: query.limit,
                        filters: query.filters,
                        sorts: query.sorts,
                        loadedState: queryOutput.loadedState,
                    },
                    ...extraQueries,
                ],
                taskIds: [],
                collectionIds: [collectionId],
                updateEvent,
            },
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

export default function TaskCollectionRoute() {
    const collectionId = Schema.id<TaskCollectionId>().deserialize(
        useParams().collectionId ?? null,
    );

    return (
        <TaskCollectionRouteInner
            // Remount when the collection changes...
            key={collectionId}
            collectionId={collectionId}
        />
    );
}

function TaskCollectionRouteInner({collectionId}: {collectionId: TaskCollectionId}) {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();

    const store = useTaskClientStore();

    const {
        queries: [query],
        collectionSubscriptions: [collectionSubscription],
    } = useTaskStoreLoaderDataWithoutRetaining();

    // Retain our queries so they aren't destroyed while we're using them.
    useEffect(() => {
        query?.retain();
        collectionSubscription?.retain();

        return () => {
            // Release after a microtask in case the component is re-rendering which will
            // synchronously call `retain()` again.
            scheduleMicrotask(() => {
                batchStoreUpdates(() => {
                    query?.release();
                    collectionSubscription?.release();
                });
            });
        };
    }, [collectionSubscription, query]);

    // Remove the `create` search param if we have a subscription to an
    // existing collection.
    useEffect(() => {
        if (!collectionSubscription) return;

        const url = new URL(window.location.href);

        if (url.searchParams.has("create")) {
            url.searchParams.delete("create");

            // Silently update the URL without telling Remix so our component doesn't
            // re-render unnecessarily.
            window.history.replaceState(null, "", url);
        }
    }, [collectionSubscription]);

    useAddTaskCollectionViewingTimeAffinityPoints(collectionSubscription);

    return (
        <TaskCollectionView
            store={store}
            collectionId={collectionId}
            collectionSubscription={collectionSubscription ?? null}
            createCollection={async name => {
                const newSearchParams = new URLSearchParams(searchParams);
                newSearchParams.set("create", name);

                await navigate(
                    `/s/${
                        store.spaceId
                    }/tasks/collections/${collectionId}?${newSearchParams.toString()}`,
                    {replace: true},
                );
            }}
        />
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
        };
    }, [collectionSubscription, context, space.id]);
}
