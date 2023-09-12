import {useCallback, useEffect, useRef, useState} from "react";
import {useAppContext} from "~/client/context/app_context.js";
import {delayLoadingIndicatorLimitMs} from "~/client/design/timing_constants.js";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {batchStoreUpdates} from "~/client/helpers/store/batch_store_updates.js";
import {StoreMap} from "~/client/helpers/store/store_map.js";
import {useBrowserId} from "~/client/remix/client_info_context.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {TaskClientStore} from "~/client/tasks/task_client_store.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {stringifyForDeepEqualCheck} from "~/shared/helpers/control/stringify_for_deep_equal_check.js";
import {
    collapseChildTasksInGridView,
    expandChildTasksInGridView,
} from "~/shared/rpc/tasks_rpc_definitions.js";
import {Schema} from "~/shared/schema/schema.js";
import {
    TaskGridViewTaskKey,
    TaskGridViewTaskKeySchema,
    parseTaskGridViewTaskKey,
} from "~/shared/tasks/task_grid_view_task_key.js";
import {TaskQueryNormalizedFilters} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";

const BroadcastChannelMessageSchema = Schema.object({
    taskKey: TaskGridViewTaskKeySchema,
    areChildTasksExpanded: Schema.boolean,
});

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
export function useTaskGridViewExpansionState({
    store,
    filters,
    sorts,
    initialExpandedChildTaskKeys,
}: {
    store: TaskClientStore;
    filters: TaskQueryNormalizedFilters;
    sorts: ReadonlyArray<TaskQueryNormalizedSort>;
    initialExpandedChildTaskKeys: ReadonlySet<TaskGridViewTaskKey>;
}) {
    const context = useAppContext();
    const browserId = useBrowserId();
    const {space} = useSpaceContext();

    const [state, setState] = useState(() => ({
        filters,
        sorts,
        areChildTasksExpandedByTaskKey: new StoreMap<TaskGridViewTaskKey, boolean>(
            Array.from(initialExpandedChildTaskKeys, taskKey => [taskKey, true]),
        ),
    }));

    // If filters/sorts changed since we mounted then we need to reset our state.
    if (state.filters !== filters || state.sorts !== sorts) {
        setState({
            filters,
            sorts,
            areChildTasksExpandedByTaskKey: new StoreMap<TaskGridViewTaskKey, boolean>(
                Array.from(initialExpandedChildTaskKeys, taskKey => [taskKey, true]),
            ),
        });
    }

    const isMountedRef = useRef(false);

    // When we mount, retain a reference to all children queries for expanded
    // tasks. When we unmount release references to children queries for
    // expanded tasks.
    useEffect(() => {
        isMountedRef.current = true;

        for (const [
            taskKey,
            areChildTasksExpanded,
        ] of state.areChildTasksExpandedByTaskKey.entriesSnapshot()) {
            if (!areChildTasksExpanded) continue;

            const {taskId} = parseTaskGridViewTaskKey(taskKey);
            store.getTaskChildrenQueryStore(taskId).getSnapshot()?.retain();
        }

        return () => {
            isMountedRef.current = false;

            for (const [
                taskKey,
                areChildTasksExpanded,
            ] of state.areChildTasksExpandedByTaskKey.entriesSnapshot()) {
                if (!areChildTasksExpanded) continue;

                const {taskId} = parseTaskGridViewTaskKey(taskKey);
                store.getTaskChildrenQueryStore(taskId).getSnapshot()?.release();
            }
        };
    }, [state.areChildTasksExpandedByTaskKey, store]);

    const {areChildTasksExpandedByTaskKey} = state;

    // We construct a broadcast channel so when a task expand/collapse happens we
    // can inform other tabs in our browser given that expansion state is shared
    // among browser tabs in the backend.
    //
    // This is by no means sound! We don't sync state across tabs when initially
    // connecting and events may not be properly ordered. However it covers the
    // common case of "I have two browser tabs open and I want to see tasks in the
    // same state as I'll get if I reload the page". It's not a big deal if there
    // are temporary inconsistencies between the expansion state of two tabs.
    const broadcastChannelRef = useRef<BroadcastChannel | null>(null);
    useEffect(() => {
        const broadcastChannel = new BroadcastChannel(
            `TaskGridViewExpansionState:${browserId}:${stringifyForDeepEqualCheck({
                filters,
                sorts,
            })}`,
        );
        broadcastChannelRef.current = broadcastChannel;

        broadcastChannel.addEventListener("message", event => {
            const {taskKey, areChildTasksExpanded} = BroadcastChannelMessageSchema.deserialize(
                event.data,
            );

            areChildTasksExpandedByTaskKey.set(taskKey, areChildTasksExpanded);
        });

        return () => {
            broadcastChannelRef.current = null;
            broadcastChannel.close();
        };
    }, [areChildTasksExpandedByTaskKey, browserId, filters, sorts]);

    const isExpandingTaskKeysRef = useRef(new Set<TaskGridViewTaskKey>());

    const toggleAreChildTasksExpanded = useEvent((taskKey: TaskGridViewTaskKey) => {
        batchStoreUpdates(() => {
            // Our mount effect manages our retain/release cycle. If we're unmounted then
            // we shouldn't be retaining/releasing resources.
            assert(isMountedRef.current);

            const {taskId} = parseTaskGridViewTaskKey(taskKey);
            const areChildTasksExpanded = areChildTasksExpandedByTaskKey.getSnapshot(taskKey);

            if (areChildTasksExpanded) {
                // 1. Release the reference to the children query for the collapsed task to
                //    clean up resources
                store.getTaskChildrenQueryStore(taskId).getSnapshot()?.release();

                // 2. Set our task as collapsed in local state
                areChildTasksExpandedByTaskKey.set(taskKey, false);

                // 3. Set our task as collapsed in local state in other browser tabs
                broadcastChannelRef.current?.postMessage(
                    BroadcastChannelMessageSchema.serialize({
                        taskKey,
                        areChildTasksExpanded: false,
                    }),
                );

                // 4. Set our task as collapsed in local state on the server
                collapseChildTasksInGridView(context, {
                    spaceId: space.id,
                    browserId,
                    filters,
                    sorts,
                    taskKey,
                }).catch(error => {
                    // If we couldn't persist task grid view expansion state then log an error but
                    // don't present an error alert to the user. Locally tasks should still expand
                    // just fine.
                    //
                    // This is a glitch. Users won't see the correct tasks expanded/collapsed when
                    // they reload the page.
                    context.tracer
                        .getRoot()
                        .logUncaughtException(
                            "Couldn't persist task grid view expansion state",
                            error,
                        );
                });
            } else {
                // Expanding a task may be asynchronous. If we're already expanding don't
                // attempt to expand again. This prevents users who double click really fast
                // from double expanding.
                if (isExpandingTaskKeysRef.current.has(taskKey)) return;
                isExpandingTaskKeysRef.current.add(taskKey);

                // 1. Get an existing query or create a new children's query and retain a
                //    reference to that query.
                const query = store.ensureAndRetainTaskChildrenQuery(taskId, {
                    // NOCOMMIT: Proper limit?
                    desiredCount: 500,
                });

                if (query.loadedStateStore.getSnapshot() !== "Unloaded") {
                    actuallyExpand();
                } else {
                    const loadPromise = new Promise<void>(resolve => {
                        const unsubscribe = query.loadedStateStore.subscribe(() => {
                            if (query.loadedStateStore.getSnapshot() !== "Unloaded") {
                                unsubscribe();
                                resolve();
                            }
                        });
                    });

                    Promise.race([loadPromise, wait(delayLoadingIndicatorLimitMs)]).finally(
                        actuallyExpand,
                    );
                }

                function actuallyExpand() {
                    try {
                        // If we unmounted while loading data then release the query (since an unmount
                        // effect won't release it) and don't update our state.
                        if (!isMountedRef.current) {
                            query.release();
                            return;
                        }

                        // 2. Set our task as expanded in local state
                        areChildTasksExpandedByTaskKey.set(taskKey, true);

                        // 3. Set our task as expanded in local state in other browser tabs
                        broadcastChannelRef.current?.postMessage(
                            BroadcastChannelMessageSchema.serialize({
                                taskKey,
                                areChildTasksExpanded: true,
                            }),
                        );

                        // 4. Set our task as expanded in local state on the server
                        expandChildTasksInGridView(context, {
                            spaceId: space.id,
                            browserId,
                            filters,
                            sorts,
                            taskKey,
                        }).catch(error => {
                            // If we couldn't persist task grid view expansion state then log an error but
                            // don't present an error alert to the user. Locally tasks should still expand
                            // just fine.
                            //
                            // This is a glitch. Users won't see the correct tasks expanded/collapsed when
                            // they reload the page.
                            context.tracer
                                .getRoot()
                                .logUncaughtException(
                                    "Couldn't persist task grid view expansion state",
                                    error,
                                );
                        });
                    } finally {
                        isExpandingTaskKeysRef.current.delete(taskKey);
                    }
                }
            }
        });
    });

    return {
        toggleAreChildTasksExpanded,
        getAreChildTasksExpandedStore: useCallback(
            (taskKey: TaskGridViewTaskKey) => areChildTasksExpandedByTaskKey.get(taskKey),
            [areChildTasksExpandedByTaskKey],
        ),
    };
}
