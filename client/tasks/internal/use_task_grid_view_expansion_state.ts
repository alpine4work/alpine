import {useCallback, useEffect, useRef, useState} from "react";
import {useAppContext} from "~/client/context/app_context.js";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {StoreMap} from "~/client/helpers/store/store_map.js";
import {useBrowserId} from "~/client/remix/client_info_context.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {stringifyForDeepEqualCheck} from "~/shared/helpers/control/stringify_for_deep_equal_check.js";
import {
    collapseChildTasksInGridView,
    expandChildTasksInGridView,
} from "~/shared/rpc/tasks_rpc_definitions.js";
import {Schema} from "~/shared/schema/schema.js";
import {
    TaskGridViewTaskKey,
    TaskGridViewTaskKeySchema,
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
    filters,
    sorts,
    initialExpandedChildTaskKeys,
}: {
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

    const toggleAreChildTasksExpanded = useEvent((taskKey: TaskGridViewTaskKey) => {
        const areChildTasksExpanded = areChildTasksExpandedByTaskKey.getSnapshot(taskKey);

        if (areChildTasksExpanded) {
            areChildTasksExpandedByTaskKey.set(taskKey, false);

            broadcastChannelRef.current?.postMessage(
                BroadcastChannelMessageSchema.serialize({
                    taskKey,
                    areChildTasksExpanded: false,
                }),
            );

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
                    .logUncaughtException("Couldn't persist task grid view expansion state", error);
            });
        } else {
            areChildTasksExpandedByTaskKey.set(taskKey, true);

            broadcastChannelRef.current?.postMessage(
                BroadcastChannelMessageSchema.serialize({
                    taskKey,
                    areChildTasksExpanded: true,
                }),
            );

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
                    .logUncaughtException("Couldn't persist task grid view expansion state", error);
            });
        }
    });

    return {
        toggleAreChildTasksExpanded,
        getAreChildTasksExpandedStore: useCallback(
            (taskKey: TaskGridViewTaskKey) => areChildTasksExpandedByTaskKey.get(taskKey),
            [areChildTasksExpandedByTaskKey],
        ),
    };
}
