import {RefObject, useCallback, useEffect, useRef, useState} from "react";
import {AppContext, useAppContext} from "~/client/context/app_context.js";
import {delayLoadingIndicatorLimitMs} from "~/client/design/timing_constants.js";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {batchStoreUpdates} from "~/client/helpers/store/batch_store_updates.js";
import {Store} from "~/client/helpers/store/store.js";
import {StoreMap} from "~/client/helpers/store/store_map.js";
import {useBrowserId} from "~/client/remix/client_info_context.js";
import {TaskClientQuery} from "~/client/tasks/task_client_query.js";
import {TaskClientStore} from "~/client/tasks/task_client_store.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {stringifyForDeepEqualCheck} from "~/shared/helpers/control/stringify_for_deep_equal_check.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {BrowserId, TaskId} from "~/shared/id/types/id_types.js";
import {updateTaskGridViewExpansionState} from "~/shared/rpc/tasks_rpc_definitions.js";
import {
    TaskGridViewExpansionState,
    areChildTasksExpandedInGridView,
    collapseChildTaskInGridView,
    diffTaskGridViewExpansionStates,
    expandChildTaskInGridView,
} from "~/shared/tasks/task_grid_view_expansion_state.js";
import {TaskQueryNormalizedFilters} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";

function createTaskGridViewExpansionStateManager({
    getContext,
    store,
    browserId,
    filters,
    sorts,
    initialState,
    broadcastChannelRef,
    addRetainedQueryStore,
    removeRetainedQueryStore,
}: {
    getContext: () => AppContext;
    store: TaskClientStore;
    browserId: BrowserId;
    filters: TaskQueryNormalizedFilters;
    sorts: ReadonlyArray<TaskQueryNormalizedSort>;
    initialState: TaskGridViewExpansionState;
    broadcastChannelRef: RefObject<BroadcastChannel | null>;
    addRetainedQueryStore: (queryStore: Store<TaskClientQuery | undefined>) => void;
    removeRetainedQueryStore: (queryStore: Store<TaskClientQuery | undefined>) => void;
}) {
    let state: TaskGridViewExpansionState = null;
    const areChildTasksExpandedStoreByTaskPath = new StoreMap<string, true>();

    let updateThrottleState: {hasUpdated: boolean; timeout: Timeout} | null = null;

    const updateLocally = (
        action: (oldState: TaskGridViewExpansionState) => TaskGridViewExpansionState,
    ) => {
        batchStoreUpdates(() => {
            const oldState = state;
            const newState = action(oldState);

            state = newState;

            // Diff the before/after states and use the diff to update our stores. Our UI
            // subscribes to stores so only the precise part of the tree that changed needs
            // to re-render.
            for (const change of diffTaskGridViewExpansionStates(oldState, newState)) {
                if (change.isExpanded) {
                    areChildTasksExpandedStoreByTaskPath.set(change.taskPath.join("-"), true);

                    const taskId = change.taskPath[change.taskPath.length - 1]!;
                    addRetainedQueryStore(store.getTaskChildrenQueryStore(taskId));
                } else {
                    areChildTasksExpandedStoreByTaskPath.delete(change.taskPath.join("-"));

                    const taskId = change.taskPath[change.taskPath.length - 1]!;
                    removeRetainedQueryStore(store.getTaskChildrenQueryStore(taskId));
                }
            }
        });
    };

    const update = (
        action: (oldState: TaskGridViewExpansionState) => TaskGridViewExpansionState,
    ) => {
        updateLocally(action);

        // Broadcast to any other browser tabs our new expansion state.
        broadcastChannelRef.current?.postMessage(state);

        const sendUpdate = () => {
            const context = getContext();

            updateTaskGridViewExpansionState(context, {
                spaceId: store.spaceId,
                browserId,
                filters,
                sorts,
                state,
            }).catch(error => {
                // If we couldn't persist task grid view expansion state then log an error but
                // don't present an error alert to the user. Locally tasks should still expand
                // just fine.
                //
                // This is a glitch. Users won't see the correct tasks expanded/collapsed when
                // they reload the page.
                context.tracer
                    .getRoot()
                    .logUncaughtException("Couldn't persist task grid view expansion state", error);
            });
        };

        // We throttle updates to our expansion state to once every second or so. In case
        // the user is spamming task open/closes.
        if (updateThrottleState !== null) {
            updateThrottleState.hasUpdated = true;
        } else {
            sendUpdate();

            const createThrottleTimeout = () =>
                createTimeout(() => {
                    if (!updateThrottleState?.hasUpdated) {
                        updateThrottleState = null;
                        return;
                    }

                    updateThrottleState = {
                        hasUpdated: false,
                        timeout: createThrottleTimeout(),
                    };

                    sendUpdate();
                }, 1000);

            updateThrottleState = {
                hasUpdated: false,
                timeout: createThrottleTimeout(),
            };
        }
    };

    // Update locally with our initial state. This will also update our stores.
    updateLocally(() => initialState);

    return {
        store,
        browserId,
        filters,
        sorts,
        update,
        updateLocally,

        /**
         * Is the task at this path expanded? Should not be called during React render
         * as this reads mutable state. Instead call `getAreChildTasksExpandedStore()`
         * for use during React render.
         */
        areChildTasksExpanded: (taskPath: ReadonlyArray<TaskId>) =>
            areChildTasksExpandedInGridView(state, taskPath),

        /**
         * Returns a store that tells us whether the task at this path is expanded.
         */
        getAreChildTasksExpandedStore: (taskPath: ReadonlyArray<TaskId>) =>
            areChildTasksExpandedStoreByTaskPath.get(taskPath.join("-")),

        /**
         * Iterate all expanded `TaskId`s in our state. Should not be called during
         * React render as this reads mutable state.
         *
         * May iterate over the same `TaskId` multiple times if it is present and
         * expanded multiple times in our grid view. To get the full (unique) path of
         * a task you may call `getTaskPath()`.
         */
        iterateExpandedTaskIds: (): Iterable<{taskId: TaskId; getTaskPath: () => Array<TaskId>}> =>
            mapIterable(areChildTasksExpandedStoreByTaskPath.keysSnapshot(), taskPath => {
                const lastTaskIdStartIndex = taskPath.lastIndexOf("-");
                const taskId =
                    lastTaskIdStartIndex === -1
                        ? (taskPath as TaskId)
                        : (taskPath.slice(lastTaskIdStartIndex + 1) as TaskId);
                return {taskId, getTaskPath: () => taskPath.split("-") as Array<TaskId>};
            }),

        /**
         * Iterate all expanded `TaskId`s in our state under a certain path. Should not
         * be called during React render as this reads mutable state.
         *
         * Does not include the task at the provided `taskPath`.
         *
         * Ignores whether the task at `taskPath` or any parent tasks are collapsed.
         *
         * May iterate over the same `TaskId` multiple times if it is present and
         * expanded multiple times in our grid view. To get the full (unique) path of
         * a task you may call `getTaskPath()`.
         */
        iterateExpandedTaskIdsUnderPath: (
            taskPath: ReadonlyArray<TaskId>,
        ): Iterable<{taskId: TaskId; getTaskPath: () => Array<TaskId>}> => {
            let currentState = state;
            for (const taskId of taskPath) {
                currentState = currentState?.get(taskId)?.childTasks ?? null;
                if (!currentState) break;
            }

            return mapIterable(
                diffTaskGridViewExpansionStates(null, currentState),
                ({taskPath: remainingTaskPath, isExpanded}) => {
                    assert(isExpanded);
                    assert(remainingTaskPath.length > 0);
                    const taskId = remainingTaskPath[remainingTaskPath.length - 1]!;
                    return {taskId, getTaskPath: () => [...taskPath, ...remainingTaskPath]};
                },
            );
        },
    };
}

/**
 * Manages the expansion state of tasks in a grid view.
 *
 * Expansion state is persisted on the server so when a user navigates to a
 * grid view we render once with the correct tasks expanded. Without needing
 * network waterfalls to load child tasks.
 *
 * We are not strict about the realtime properties of task expansion state. The
 * client may see different expanded tasks then what's on the server. We try to
 * keep multiple tabs in the same browser in-sync with the `BroadcastChannel`
 * API but it's possible different tabs see different expanded states. Most of
 * the time all tabs in a browser will see the same expanded tasks as what's on
 * the server but that's not a guarantee.
 */
// NOTE(calebmer, 2023-09-13): We currently retain all children queries in our
// expansion state whether or not those queries appear in the grid view where
// the expansion state says they should. This could lead to over-retaining. If
// our expansion state says we have a task expanded at the root level but that
// task was moved under another task and our expansion state didn't update then
// when you expand the task in its new location we will permanently retain that
// query since we think we need it for the task at the root-level position
// (where it doesn't exist).
export function useTaskGridViewExpansionState({
    store,
    filters,
    sorts,
    initialState,
}: {
    store: TaskClientStore;
    filters: TaskQueryNormalizedFilters;
    sorts: ReadonlyArray<TaskQueryNormalizedSort>;
    initialState: TaskGridViewExpansionState;
}) {
    const context = useAppContext();
    const getContext = useEvent(() => context);
    const browserId = useBrowserId();

    const isMountedRef = useRef(false);
    const broadcastChannelRef = useRef<BroadcastChannel | null>(null);

    const retainedQueryStoresRef = useRef<
        Map<Store<TaskClientQuery | undefined>, {referenceCount: number; unsubscribe: () => void}>
    >(new Map());

    const addRetainedQueryStore = useCallback((queryStore: Store<TaskClientQuery | undefined>) => {
        // We only hold onto retained queries while mounted.
        if (!isMountedRef.current) return;

        const retainedQueryStore = retainedQueryStoresRef.current.get(queryStore);
        if (retainedQueryStore) {
            retainedQueryStore.referenceCount++;
        } else {
            let query = queryStore.getSnapshot();
            query?.retain();

            retainedQueryStoresRef.current.set(queryStore, {
                referenceCount: 1,
                unsubscribe: queryStore.subscribe(() => {
                    const newQuery = queryStore.getSnapshot();
                    newQuery?.retain();
                    query?.release();
                    query = newQuery;
                }),
            });
        }
    }, []);

    const removeRetainedQueryStore = useCallback(
        (queryStore: Store<TaskClientQuery | undefined>) => {
            // We only hold onto retained queries while mounted.
            if (!isMountedRef.current) return;

            const retainedQueryStore = retainedQueryStoresRef.current.get(queryStore);
            assert(retainedQueryStore, "Query store is not retained");

            retainedQueryStore.referenceCount--;

            if (retainedQueryStore.referenceCount === 0) {
                retainedQueryStoresRef.current.delete(queryStore);
                retainedQueryStore.unsubscribe();
                queryStore.getSnapshot()?.release();
            }
        },
        [],
    );

    const [stateManager, setStateManager] = useState(() =>
        createTaskGridViewExpansionStateManager({
            getContext,
            store,
            browserId,
            filters,
            sorts,
            initialState,
            broadcastChannelRef,
            addRetainedQueryStore,
            removeRetainedQueryStore,
        }),
    );

    // If filters/sorts changed since we mounted then we need to reset our state.
    if (
        stateManager.store !== store ||
        stateManager.browserId !== browserId ||
        stateManager.filters !== filters ||
        stateManager.sorts !== sorts
    ) {
        setStateManager(
            createTaskGridViewExpansionStateManager({
                getContext,
                store,
                browserId,
                filters,
                sorts,
                initialState,
                broadcastChannelRef,
                addRetainedQueryStore,
                removeRetainedQueryStore,
            }),
        );
    }

    // When we mount, retain a reference to all children queries for expanded
    // tasks. When we unmount release references to children queries for
    // expanded tasks.
    //
    // On initial load our server is responsible for preloading some child query
    // tasks so they'll be available for us in the store.
    useEffect(() => {
        isMountedRef.current = true;

        batchStoreUpdates(() => {
            for (const {taskId} of stateManager.iterateExpandedTaskIds()) {
                addRetainedQueryStore(store.getTaskChildrenQueryStore(taskId));
            }
        });

        return () => {
            batchStoreUpdates(() => {
                for (const {taskId} of stateManager.iterateExpandedTaskIds()) {
                    removeRetainedQueryStore(store.getTaskChildrenQueryStore(taskId));
                }
            });

            assert(
                // eslint-disable-next-line react-hooks/exhaustive-deps
                retainedQueryStoresRef.current.size === 0,
                "Expected all retained queries to be released",
            );

            isMountedRef.current = false;
        };
    }, [addRetainedQueryStore, removeRetainedQueryStore, stateManager, store]);

    const toggleAreChildTasksExpanded = useEvent(
        (taskPath: ReadonlyArray<TaskId>, {onFinish}: {onFinish?: () => void} = {}) => {
            batchStoreUpdates(() => {
                // Our mount effect manages our retain/release cycle. If we're unmounted then
                // we shouldn't be retaining/releasing resources.
                assert(isMountedRef.current);

                assert(taskPath.length > 0);
                const taskId = taskPath[taskPath.length - 1]!;

                if (stateManager.areChildTasksExpanded(taskPath)) {
                    stateManager.update(state => collapseChildTaskInGridView(state, taskPath));
                    onFinish?.();
                } else {
                    const taskIdsToLoad = new Set([taskId]);

                    for (const {taskId} of stateManager.iterateExpandedTaskIdsUnderPath(taskPath)) {
                        taskIdsToLoad.add(taskId);
                    }

                    // If we are expanding a task, preload all the child task queries that will be
                    // visible once the task is expanded. We wait a bit for these tasks to load
                    // then actually expand.
                    const queries = Array.from(taskIdsToLoad, taskId =>
                        store.ensureAndRetainTaskChildrenQuery(taskId, {
                            // NOCOMMIT: Proper limit?
                            desiredCount: 500,
                        }),
                    );

                    // If all the children queries are loaded, expand immediately!
                    if (
                        queries.every(query => query.loadedStateStore.getSnapshot() !== "Unloaded")
                    ) {
                        actuallyExpand();
                    } else {
                        const queriesLoadPromise = runAllPromises(
                            queries.map(query => {
                                return new Promise<void>(resolve => {
                                    const unsubscribe = query.loadedStateStore.subscribe(() => {
                                        if (query.loadedStateStore.getSnapshot() !== "Unloaded") {
                                            unsubscribe();
                                            resolve();
                                        }
                                    });
                                });
                            }),
                        );

                        // If the children queries are not loaded, wait a bit to try and avoid showing
                        // a loading spinner if the network responds fast.
                        Promise.race([
                            queriesLoadPromise,
                            wait(delayLoadingIndicatorLimitMs),
                        ]).finally(actuallyExpand);
                    }

                    function actuallyExpand() {
                        batchStoreUpdates(() => {
                            try {
                                stateManager.update(state =>
                                    expandChildTaskInGridView(state, taskPath),
                                );

                                onFinish?.();
                            } finally {
                                // `stateManager` should have taken its own reference on queries we're actually
                                // using. Since the expanded state could change while we're waiting on our
                                // queries to load. Release the reference we held while loading the query.
                                for (const query of queries) {
                                    query.release();
                                }
                            }
                        });
                    }
                }
            });
        },
    );

    // We construct a broadcast channel so when a task expand/collapse happens we
    // can inform other tabs in our browser given that expansion state is shared
    // among browser tabs in the backend.
    //
    // This is by no means sound! We don't sync state across tabs when initially
    // connecting and events may not be properly ordered. However it covers the
    // common case of "I have two browser tabs open and I want to see tasks in the
    // same state as I'll get if I reload the page". It's not a big deal if there
    // are temporary inconsistencies between the expansion state of two tabs.
    useEffect(() => {
        const broadcastChannel = new BroadcastChannel(
            `TaskGridViewExpansionState:${browserId}:${stringifyForDeepEqualCheck({
                filters,
                sorts,
            })}`,
        );
        broadcastChannelRef.current = broadcastChannel;

        broadcastChannel.addEventListener("message", event => {
            const state: TaskGridViewExpansionState = event.data;

            // Only update our state locally. Don't re-broadcast it, don't save on the
            // server. The initial broadcaster should have saved this update on the server.
            stateManager.updateLocally(() => state);
        });

        return () => {
            broadcastChannelRef.current = null;
            broadcastChannel.close();
        };
    }, [browserId, filters, sorts, stateManager]);

    return {
        toggleAreChildTasksExpanded,
        getAreChildTasksExpandedStore: stateManager.getAreChildTasksExpandedStore,
    };
}
