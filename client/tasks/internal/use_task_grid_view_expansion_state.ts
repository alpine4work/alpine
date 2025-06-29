import {CalendarDate} from "@internationalized/date";
import {RefObject, useEffect, useMemo, useRef} from "react";
import {unstable_IdlePriority, unstable_scheduleCallback} from "scheduler";
import {AppContext, useAppContext} from "~/client/context/app_context.js";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {useStateWithDependencies} from "~/client/helpers/lifecycle/use_state_with_dependencies.js";
import {getClientInfo, useBrowserId} from "~/client/remix/client_info_context.js";
import {indiscriminatelyDisableAllTaskGridViewAnimationsUntilNextBrowserPaint} from "~/client/tasks/core/disable_task_grid_view_animations_until_next_browser_paint.js";
import {TaskClientQuery} from "~/client/tasks/core/task_client_query.js";
import {
    TaskClientReadonlyStore,
    getParentTaskIdIfChildrenQuery,
} from "~/client/tasks/core/task_client_store.js";
import {getTaskGridViewLoadQueryLimit} from "~/client/tasks/get_task_grid_view_load_query_limit.js";
import {delayLoadingIndicatorLimitMs} from "~/shared/design/core/timing.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {createInterval} from "~/shared/helpers/async/interval.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {stringifyForDeepEqualCheck} from "~/shared/helpers/control/stringify_for_deep_equal_check.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {BrowserId, TaskId} from "~/shared/id/types/id_types.js";
import {updateTaskGridViewExpansionState} from "~/shared/rpc/tasks_rpc_definitions.js";
import {batchStoreUpdates} from "~/shared/store/batch_store_updates.js";
import {undefinedStore} from "~/shared/store/const_store.js";
import {Store} from "~/shared/store/store.js";
import {StoreMap} from "~/shared/store/store_map.js";
import {
    TaskGridViewExpansionState,
    TaskGridViewExpansionTaskState,
    areChildTasksExpandedInGridView,
    collapseChildTaskInGridView,
    diffTaskGridViewExpansionStates,
    expandChildTaskInGridView,
    moveTaskGridViewExpansionTaskState,
} from "~/shared/tasks/task_grid_view_expansion_state.js";
import {TaskQueryNormalizedFilters} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";

type TaskGridViewExpansionStateManager = ReturnType<typeof createTaskGridViewExpansionStateManager>;

function createTaskGridViewExpansionStateManager({
    getContext,
    store,
    browserId,
    filters,
    sorts,
    initialState,
    broadcastChannelRef,
}: {
    getContext: () => AppContext;
    store: TaskClientReadonlyStore;
    browserId: BrowserId;
    filters: TaskQueryNormalizedFilters;
    sorts: ReadonlyArray<TaskQueryNormalizedSort>;
    initialState: TaskGridViewExpansionState;
    broadcastChannelRef: RefObject<BroadcastChannel | null>;
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
            const releaseTaskIds = new Map<TaskId, number>();
            for (const change of diffTaskGridViewExpansionStates(oldState, newState)) {
                if (change.isExpanded) {
                    areChildTasksExpandedStoreByTaskPath.set(change.taskPath.join("-"), true);

                    const taskId = change.taskPath[change.taskPath.length - 1]!;
                    addRetainedQueryStore(store.getTaskChildrenQueryStore(taskId));
                } else {
                    areChildTasksExpandedStoreByTaskPath.delete(change.taskPath.join("-"));

                    const taskId = change.taskPath[change.taskPath.length - 1]!;
                    releaseTaskIds.set(taskId, (releaseTaskIds.get(taskId) ?? 0) + 1);
                }
            }

            // Perform releases after retains. In case we release a task that is
            // retained by a later change.
            for (const [taskId, count] of releaseTaskIds) {
                for (let i = 0; i < count; i++) {
                    removeRetainedQueryStore(store.getTaskChildrenQueryStore(taskId));
                }
            }
        });
    };

    const update = (
        action: (oldState: TaskGridViewExpansionState) => TaskGridViewExpansionState,
    ) => {
        const oldState = state;
        updateLocally(action);
        const newState = state;

        // If state didn't change then we don't need to send a message to other browser
        // tabs or the server.
        if (oldState === newState) return;

        // Don't persist grid view expansion state, or share it with our other tabs, if
        // the actor doesn't have access to the space. Right now, remembering grid view
        // expansion state across page reloads requires space access.
        //
        // Though in the future, we could choose to save expansion state purely based
        // on `browserId`.
        if (store.currentAccountId === null) return;

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
                    .logException("Couldn’t persist task grid view expansion state", error);
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

    const iterateExpandedTaskIds = (): Iterable<{
        taskId: TaskId;
        getTaskPath: () => Array<TaskId>;
    }> =>
        mapIterable(areChildTasksExpandedStoreByTaskPath.keysSnapshot(), taskPath => {
            const lastTaskIdStartIndex = taskPath.lastIndexOf("-");
            const taskId =
                lastTaskIdStartIndex === -1
                    ? (taskPath as TaskId)
                    : (taskPath.slice(lastTaskIdStartIndex + 1) as TaskId);
            return {taskId, getTaskPath: () => taskPath.split("-") as Array<TaskId>};
        });

    let isMounted = false;

    const retainedQueryStores = new Map<
        Store<TaskClientQuery | undefined>,
        {referenceCount: number; unsubscribe: () => void}
    >();

    const addRetainedQueryStore = (queryStore: Store<TaskClientQuery | undefined>) => {
        // We only hold onto retained queries while mounted.
        if (!isMounted) return;

        const retainedQueryStore = retainedQueryStores.get(queryStore);
        if (retainedQueryStore) {
            retainedQueryStore.referenceCount++;
        } else {
            let query = queryStore.getSnapshot();
            query?.retain();

            retainedQueryStores.set(queryStore, {
                referenceCount: 1,
                unsubscribe: queryStore.subscribe(() => {
                    const newQuery = queryStore.getSnapshot();
                    newQuery?.retain();
                    query?.release();
                    query = newQuery;
                }),
            });
        }
    };

    const removeRetainedQueryStore = (queryStore: Store<TaskClientQuery | undefined>) => {
        // We only hold onto retained queries while mounted.
        if (!isMounted) return;

        const retainedQueryStore = retainedQueryStores.get(queryStore);
        assert(retainedQueryStore, "Query store is not retained");

        retainedQueryStore.referenceCount--;

        if (retainedQueryStore.referenceCount === 0) {
            retainedQueryStores.delete(queryStore);
            retainedQueryStore.unsubscribe();
            queryStore.getSnapshot()?.release();
        }
    };

    const mount = () => {
        assert(!isMounted);
        isMounted = true;

        batchStoreUpdates(() => {
            for (const {taskId} of iterateExpandedTaskIds()) {
                addRetainedQueryStore(store.getTaskChildrenQueryStore(taskId));
            }
        });
    };

    const unmount = () => {
        assert(isMounted);

        batchStoreUpdates(() => {
            for (const {taskId} of iterateExpandedTaskIds()) {
                removeRetainedQueryStore(store.getTaskChildrenQueryStore(taskId));
            }
        });

        isMounted = false;

        assert(retainedQueryStores.size === 0, "Expected all retained queries to be released");
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
        mount,
        unmount,

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
        iterateExpandedTaskIds,

        /**
         * Iterate all the root expanded `TaskId`s in our state. Should not be called
         * during React render as this reads mutable state.
         */
        iterateRootExpandedTaskIds: (): Iterable<TaskId> => {
            return state?.keys() ?? emptyArray;
        },

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
    query,
    initialState,
}: {
    query: TaskClientQuery | null;
    initialState: TaskGridViewExpansionState;
}) {
    const context = useAppContext();
    const getContext = useEvent(() => context);
    const browserId = useBrowserId();

    const broadcastChannelRef = useRef<BroadcastChannel | null>(null);

    // When `query` changes we need to reset our state.
    const [stateManager] = useStateWithDependencies<
        TaskGridViewExpansionStateManager | null,
        [TaskClientQuery | null]
    >(
        ([query]) =>
            query
                ? createTaskGridViewExpansionStateManager({
                      getContext,
                      store: query.store,
                      browserId,
                      filters: query.filters,
                      sorts: query.sorts,
                      initialState,
                      broadcastChannelRef,
                  })
                : null,
        [query],
    );

    // When we mount, retain a reference to all children queries for expanded
    // tasks. When we unmount release references to children queries for
    // expanded tasks.
    //
    // On initial load our server is responsible for preloading some child query
    // tasks so they'll be available for us in the store.
    useEffect(() => {
        stateManager?.mount();
        return () => stateManager?.unmount();
    }, [stateManager]);

    const toggleAreChildTasksExpanded = useEvent(
        (taskPath: ReadonlyArray<TaskId>, {onFinish}: {onFinish?: () => void} = {}) => {
            if (!stateManager) return;

            batchStoreUpdates(() => {
                assert(taskPath.length > 0);
                const taskId = taskPath[taskPath.length - 1]!;

                if (stateManager.areChildTasksExpanded(taskPath)) {
                    // Don't animate when the user is toggling child tasks open/closed. That's a
                    // direct user interaction and we don't animate direct user interactions.
                    indiscriminatelyDisableAllTaskGridViewAnimationsUntilNextBrowserPaint();

                    stateManager.update(state => collapseChildTaskInGridView(state, taskPath));
                    onFinish?.();
                } else if (
                    stateManager.store.getTaskEntrySnapshot(taskId)?.task?.getChildTaskCount() === 0
                ) {
                    // Noop if the task we're toggling is loaded and has no children. There's
                    // nothing to expand! Expanded state for tasks with no children is eventually
                    // cleaned up so don't bother adding it in the first place.
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
                        stateManager.store.ensureAndRetainTaskChildrenQuery(taskId, {
                            limit: getTaskGridViewLoadQueryLimit(getClientInfo()),
                        }),
                    );

                    const actuallyExpand = () => {
                        // Don't animate when the user is toggling child tasks open/closed. That's a
                        // direct user interaction and we don't animate direct user interactions.
                        indiscriminatelyDisableAllTaskGridViewAnimationsUntilNextBrowserPaint();

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
                    };

                    // If all the children queries are loaded, expand immediately!
                    if (
                        queries.every(query => query.loadedStateStore.getSnapshot() !== "Unloaded")
                    ) {
                        actuallyExpand();
                    } else {
                        const queriesLoadPromise = runAllPromises(
                            queries.map(query => query.waitForLoaded()),
                        );

                        // If the children queries are not loaded, wait a bit to try and avoid showing
                        // a loading spinner if the network responds fast.
                        void Promise.race([
                            queriesLoadPromise,
                            wait(delayLoadingIndicatorLimitMs),
                        ]).finally(actuallyExpand);
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
        if (!stateManager) return;

        const broadcastChannel = new BroadcastChannel(
            `TaskGridViewExpansionState:${browserId}:${stringifyForDeepEqualCheck<CalendarDate>(
                {
                    filters: stateManager.filters,
                    sorts: stateManager.sorts,
                },
                date => date.toString(),
            )}`,
        );
        broadcastChannelRef.current = broadcastChannel;

        broadcastChannel.addEventListener("message", event => {
            const state: TaskGridViewExpansionState = event.data;

            // If we're syncing expansion state from another tab, don't animate.
            indiscriminatelyDisableAllTaskGridViewAnimationsUntilNextBrowserPaint();

            // Only update our state locally. Don't re-broadcast it, don't save on the
            // server. The initial broadcaster should have saved this update on the server.
            stateManager.updateLocally(() => state);
        });

        return () => {
            broadcastChannelRef.current = null;
            broadcastChannel.close();
        };
    }, [browserId, stateManager]);

    // Watch for any change to a task that updates its parent `TaskId`. When the
    // parent `TaskId` changes we want to move our task's expansion state from its
    // old location to its new location.
    //
    // Note that this only works if the user's browser is open and actively
    // connected to realtime! Otherwise expansion state is lost when tasks move
    // around. This is acceptable. When the user returns some tasks may be
    // unexpectedly collapsed but it's unlikely they'll notice or care.
    useEffect(() => {
        if (!stateManager) return;

        const queryParentTaskId = getParentTaskIdIfChildrenQuery(stateManager);

        return stateManager.store.subscribeToBatchUpdate(({taskEntryUpdateById, actions}) => {
            const releaseCallbacks: Array<() => void> = [];
            const childTaskIdsByNewlyCreatedParentTaskId = new Map<TaskId, Array<TaskId>>();
            const isNewlyCreatedTaskById = new Map<TaskId, boolean>();

            try {
                // This for loop does the following:
                //
                // 1. Detects updates that are indenting a task (aka
                //    `nestWithPreviousTaskRowIfExistsAndExpand()`) and makes the previous
                //    task's children are expanded. To do this we need to compute `oldTaskPath`
                //    and `newTaskPath` then check that `oldTaskPath` is a prefix of
                //    `newTaskPath`.
                //
                //    This is done here so users observing an indent in realtime also see the
                //    parent task's children expand.
                //
                // 2. Populate `childTaskIdsByNewlyCreatedParentTaskId` which contains all
                //    updated tasks that have a parent that was newly introduced (aka null
                //    `oldTaskEntry`) in this update. We use this map below.
                for (const {oldTaskEntry, newTaskEntry} of taskEntryUpdateById.values()) {
                    if (!newTaskEntry.task) continue;

                    const newParentTaskId = newTaskEntry.task.getParent()?.taskId ?? null;

                    if (newParentTaskId) {
                        const taskEntryUpdate = taskEntryUpdateById.get(newParentTaskId);
                        if (
                            taskEntryUpdate &&
                            !taskEntryUpdate.oldTaskEntry &&
                            taskEntryUpdate.newTaskEntry &&
                            // Make sure the task was actually created in this update by checking actions.
                            // Instead of being newly introduced to the store through a backfill.
                            getOrSetDefaultMapValue(isNewlyCreatedTaskById, newParentTaskId, () =>
                                actions.some(
                                    action =>
                                        action.type === "UpdateTask" &&
                                        action.taskAction.type === "Create" &&
                                        action.taskId === newParentTaskId,
                                ),
                            )
                        ) {
                            getOrSetDefaultMapValue(
                                childTaskIdsByNewlyCreatedParentTaskId,
                                newParentTaskId,
                                () => [],
                            ).push(newTaskEntry.task.id);
                        }
                    }

                    if (!oldTaskEntry?.task) continue;

                    const oldParentTaskId = oldTaskEntry.task.getParent()?.taskId ?? null;

                    // Handle parent task changing. We detect if this is a nesting operation and
                    // automatically expand the parent task if so.
                    if (oldParentTaskId !== newParentTaskId) {
                        const oldTaskPath: Array<TaskId> = [];
                        {
                            const seenTaskIds = new Set<TaskId>([oldTaskEntry.task.id]);
                            let oldGrandParentTaskId = oldParentTaskId;
                            while (
                                oldGrandParentTaskId !== null &&
                                oldGrandParentTaskId !== queryParentTaskId
                            ) {
                                // Don't loop forever if our client encounters a cycle. Cycles are possible if
                                // events are applied out-of-order.
                                if (seenTaskIds.has(oldGrandParentTaskId)) break;
                                seenTaskIds.add(oldGrandParentTaskId);

                                oldTaskPath.push(oldGrandParentTaskId);

                                oldGrandParentTaskId =
                                    stateManager.store
                                        .getTaskEntrySnapshot(oldGrandParentTaskId)
                                        ?.task?.getParent()?.taskId ?? null;
                            }

                            // We push parent tasks onto the end but task paths have parent tasks in
                            // the front.
                            oldTaskPath.reverse();
                        }

                        const newTaskPath: Array<TaskId> = [];
                        {
                            const seenTaskIds = new Set<TaskId>([newTaskEntry.task.id]);
                            let newGrandParentTaskId = newParentTaskId;
                            while (
                                newGrandParentTaskId !== null &&
                                newGrandParentTaskId !== queryParentTaskId
                            ) {
                                // Don't loop forever if our client encounters a cycle. Cycles are possible if
                                // events are applied out-of-order.
                                if (seenTaskIds.has(newGrandParentTaskId)) break;
                                seenTaskIds.add(newGrandParentTaskId);

                                newTaskPath.push(newGrandParentTaskId);

                                newGrandParentTaskId =
                                    stateManager.store
                                        .getTaskEntrySnapshot(newGrandParentTaskId)
                                        ?.task?.getParent()?.taskId ?? null;
                            }

                            // We push parent tasks onto the end but task paths have parent tasks in
                            // the front.
                            newTaskPath.reverse();
                        }

                        // If this update was the result of an indent (task nested under previous task)
                        // and this is the first child task of the new parent then we want to
                        // immediately expand the new parent's child tasks.
                        //
                        // If the task has only one child then we know it's our new task. Create a
                        // query and update it to a fully loaded state with our task. Finally update
                        // the task's expansion state.
                        //
                        // It's important we put this logic here instead of in a function like
                        // `nestWithPreviousTaskRowIfExistsAndExpand()`. Because this will run for both
                        // our current user and a user viewing the grid view in realtime.
                        if (
                            newTaskPath.length === oldTaskPath.length + 1 &&
                            oldTaskPath.every((taskId, i) => newTaskPath[i] === taskId) &&
                            stateManager.areChildTasksExpanded(oldTaskPath) &&
                            stateManager.store
                                .getTaskEntrySnapshot(newTaskPath[newTaskPath.length - 1]!)
                                ?.task?.getChildTaskCount() === 1
                        ) {
                            const taskChildrenQuery =
                                stateManager.store.ensureAndRetainTaskChildrenQuery(
                                    newTaskPath[newTaskPath.length - 1]!,
                                    {limit: 1},
                                );

                            // Release our query at the end of this code block. `stateManager` will grab
                            // its own reference to the query if we need it.
                            releaseCallbacks.push(() => {
                                taskChildrenQuery.release();
                            });

                            if (
                                taskChildrenQuery.loadedStateStore.getSnapshot() !== "FullyLoaded"
                            ) {
                                stateManager.store.loadTasksIntoQuery(taskChildrenQuery, {
                                    limit: 1,
                                    loadedState: {type: "Full"},
                                    previouslyBackfilledTaskIds: [newTaskEntry.task.id],
                                });
                            }

                            stateManager.update(state =>
                                expandChildTaskInGridView(state, newTaskPath),
                            );
                        }

                        stateManager.update(state =>
                            moveTaskGridViewExpansionTaskState(
                                state,
                                oldTaskPath,
                                newTaskPath,
                                oldTaskEntry.task.id,
                            ),
                        );
                    }
                }

                // If our update created some task and add some children to the task in the
                // same update then we want to expand the created task. For example, if you
                // copy a bullet list that looks like this:
                //
                // ```
                // - Task 1
                //   - Task 1a
                //   - Task 1b
                //   - Task 1c
                // - Task 2
                // ```
                //
                // Then you paste we create these five tasks in one update and we want "Task 1"
                // to be expanded. Given we know "Task 1" was just created in this update then
                // we know all the child tasks on the client (they're in this update).
                //
                // We do this here instead of the paste handling code in `<TaskRowTitleInput>`
                // because we want to expand pasted tasks on all clients observing the task
                // query in realtime. Not just the client performing the paste.
                for (const [
                    newlyCreatedParentTaskId,
                    childTaskIds,
                ] of childTaskIdsByNewlyCreatedParentTaskId) {
                    const taskChildrenQuery = stateManager.store.ensureAndRetainTaskChildrenQuery(
                        newlyCreatedParentTaskId,
                        {limit: childTaskIds.length},
                    );

                    // Release our query at the end of this code block. `stateManager` will grab
                    // its own reference to the query if we need it.
                    releaseCallbacks.push(() => {
                        taskChildrenQuery.release();
                    });

                    if (taskChildrenQuery.loadedStateStore.getSnapshot() !== "FullyLoaded") {
                        stateManager.store.loadTasksIntoQuery(taskChildrenQuery, {
                            limit: childTaskIds.length,
                            loadedState: {type: "Full"},
                            previouslyBackfilledTaskIds: childTaskIds,
                        });
                    }

                    const taskPath: Array<TaskId> = [];
                    {
                        const seenTaskIds = new Set<TaskId>([]);
                        let oldGrandParentTaskId: TaskId | null = newlyCreatedParentTaskId;
                        while (
                            oldGrandParentTaskId !== null &&
                            oldGrandParentTaskId !== queryParentTaskId
                        ) {
                            // Don't loop forever if our client encounters a cycle. Cycles are possible if
                            // events are applied out-of-order.
                            if (seenTaskIds.has(oldGrandParentTaskId)) break;
                            seenTaskIds.add(oldGrandParentTaskId);

                            taskPath.push(oldGrandParentTaskId);

                            oldGrandParentTaskId =
                                stateManager.store
                                    .getTaskEntrySnapshot(oldGrandParentTaskId)
                                    ?.task?.getParent()?.taskId ?? null;
                        }

                        // We push parent tasks onto the end but task paths have parent tasks in
                        // the front.
                        taskPath.reverse();
                    }

                    stateManager.update(state => expandChildTaskInGridView(state, taskPath));
                }
            } finally {
                // Run our release callbacks after a microtask so that `batchStoreUpdates()`
                // listeners can be called. They might retain our query so we don't want to
                // release before then.
                scheduleMicrotask(() => {
                    for (const callback of releaseCallbacks) {
                        callback();
                    }
                });
            }
        });
    }, [stateManager]);

    // After we mount and then every ~3 minutes after that, remove incorrect
    // expansion state paths. You see when the user changes the parentage of a task
    // there's no system that's responsible for keeping expansion state (which
    // mirrors the grid view's tree structure) correct. If the client is connected
    // to realtime then we'll attempt to move expansion state around when parent
    // tasks change, but that's a small UX win we can't depend on for correctness.
    //
    // So instead we "garbage collect" expansion state when we have some idle time.
    useEffect(() => {
        if (!query || !stateManager) return;

        let isCancelled = false;

        const scheduleCleanup = () => {
            // In case the browser is actively doing some work (like a React render)
            // schedule an idle callback.
            //
            // We can't use `requestIdleCallback()` since it's not implemented in Safari.
            // Generally we recommend using the React scheduler since it has centralized
            // knowledge of all our tasks.
            unstable_scheduleCallback(unstable_IdlePriority, cleanup);
        };

        const cleanup = () => {
            if (isCancelled) return;

            stateManager.update(oldState => {
                const cleanup = (
                    query: TaskClientQuery,
                    oldState: TaskGridViewExpansionState,
                ): TaskGridViewExpansionState => {
                    if (!oldState) return oldState;

                    let newState: Map<TaskId, TaskGridViewExpansionTaskState> | undefined =
                        undefined;

                    for (const [taskId, oldTaskState] of oldState) {
                        const taskEntryStore = query.getLoadedTaskEntryStoreIfExists(taskId);

                        if (!taskEntryStore) {
                            // If the query is not fully loaded the task may exist later in the query so we
                            // can't clean it up.
                            if (query.loadedStateStore.getSnapshot() !== "FullyLoaded") {
                                continue;
                            }

                            // The task does not exist in the query. Clean up its expansion state.
                            newState ??= new Map(oldState);
                            newState.delete(taskId);
                            continue;
                        }

                        // If the task isn't expanded then we won't have loaded its children so we
                        // can't clean it up.
                        if (!oldTaskState.isExpanded) continue;

                        const taskEntry = taskEntryStore.getSnapshot();

                        // If the task has no children but is marked as expanded then remove the
                        // expanded state.
                        if (taskEntry.task && taskEntry.task.getChildTaskCount() === 0) {
                            newState ??= new Map(oldState);
                            newState.delete(taskId);
                            continue;
                        }

                        const childrenQuery = query.store
                            .getTaskChildrenQueryStore(taskId)
                            .getSnapshot();
                        if (!childrenQuery) continue;

                        const newChildTasks = cleanup(childrenQuery, oldTaskState.childTasks);
                        if (newChildTasks === oldTaskState.childTasks) continue;

                        newState ??= new Map(oldState);

                        if (!oldTaskState.isExpanded && newChildTasks === null) {
                            newState.delete(taskId);
                        } else {
                            newState.set(taskId, {
                                isExpanded: oldTaskState.isExpanded,
                                childTasks: newChildTasks,
                            });
                        }
                    }

                    return newState ? (newState.size > 0 ? newState : null) : oldState;
                };

                return cleanup(query, oldState);
            });
        };

        // Immediately schedule a cleanup after initial load.
        scheduleCleanup();

        const interval = createInterval(scheduleCleanup, 1000 * 60 * 3);

        return () => {
            isCancelled = true;
            interval.clear();
        };
    }, [query, stateManager]);

    return {
        toggleAreChildTasksExpanded,
        getAreChildTasksExpandedStore: useMemo(
            () => stateManager?.getAreChildTasksExpandedStore ?? (() => undefinedStore),
            [stateManager?.getAreChildTasksExpandedStore],
        ),
        iterateRootExpandedTaskIds: useMemo(
            () => stateManager?.iterateRootExpandedTaskIds ?? (() => emptyArray),
            [stateManager?.iterateRootExpandedTaskIds],
        ),
        iterateExpandedTaskIdsUnderPath: useMemo(
            () => stateManager?.iterateExpandedTaskIdsUnderPath ?? (() => emptyArray),
            [stateManager?.iterateExpandedTaskIdsUnderPath],
        ),
    };
}
