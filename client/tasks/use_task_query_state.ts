import {useEffect, useMemo, useState} from "react";
import {batchStoreUpdates} from "~/client/helpers/store/batch_store_updates.js";
import {getClientInfoWithoutListening} from "~/client/remix/client_info_context.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {getTaskGridViewLoadQueryLimit} from "~/client/tasks/get_task_grid_view_load_query_limit.js";
import {disableAllTaskGridViewAnimationsUntilNextBrowserPaint} from "~/client/tasks/internal/task_grid_view_virtualized_list.js";
import {TaskClientQuery} from "~/client/tasks/task_client_query.js";
import {TaskClientStore} from "~/client/tasks/task_client_store.js";
import {getTaskRealtimeClientIfExistsForClient} from "~/client/tasks/task_realtime_client_context_provider.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {iterableEvery} from "~/shared/helpers/iterable/iterable_every.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, TaskId} from "~/shared/id/types/id_types.js";
import {TaskGridViewExpansionState} from "~/shared/tasks/task_grid_view_expansion_state.js";
import {TaskQueryNormalizedFilters} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";

/**
 * Will a task query with these filters be missing a filter it needs to be
 * authorized on the server?
 */
export function isTaskQueryMissingRequiredFilters(
    currentAccountId: AccountId,
    filters: TaskQueryNormalizedFilters,
): boolean {
    if (
        filters.creatorFilter?.type === "OneOf" &&
        filters.creatorFilter.accountIds.size === 1 &&
        filters.creatorFilter.accountIds.has(currentAccountId)
    ) {
        return false;
    }

    if (
        filters.assigneeFilter?.type === "OneOf" &&
        filters.assigneeFilter.accountIds.size === 1 &&
        filters.assigneeFilter.accountIds.has(currentAccountId)
    ) {
        return false;
    }

    // Assume that if the user filtered on a collection that they have access to
    // the collection.
    if (
        filters.collectionsFilter?.some(clause =>
            iterableEvery(clause, ([term, not]) => term !== "IsEmpty" && !not),
        )
    ) {
        return false;
    }

    return true;
}

export type TaskQueryState = {
    readonly activeQuery:
        | {readonly isAvailable: true; readonly query: TaskClientQuery}
        | {
              readonly isAvailable: false;
              readonly isMissingRequiredFilters: boolean;
              readonly query: null;
          };
    readonly pendingQuery: TaskClientQuery | null;
    readonly initialGridViewExpansionState: TaskGridViewExpansionState;
    readonly initialBottomGhostTaskId: TaskId;
};

/**
 * Hook that allows you to change your query filters/sorts out locally without
 * a Remix navigation or `loader` call (which adds overhead).
 *
 * This hook is not required for rendering data based on a task query. You
 * could pass the `initialQuery` from the server directly into
 * `useTaskGridViewVirtualizedList()` or however you're choosing to render
 * the query. You only need this hook if you want to change the query's
 * filters/sorts.
 */
export function useTaskQueryState({
    store,
    initialQuery,
    initialGridViewExpansionState,
    initialBottomGhostTaskId,
    filters,
    sorts,
}: {
    store: TaskClientStore;
    initialQuery: TaskClientQuery | null;
    initialGridViewExpansionState: TaskGridViewExpansionState;
    initialBottomGhostTaskId: TaskId;
    filters: TaskQueryNormalizedFilters | null;
    sorts: ReadonlyArray<TaskQueryNormalizedSort>;
}): TaskQueryState {
    const {space, currentAccount} = useSpaceContext();

    // Custom views must start with a filter we know the user has access to. We
    // don't yet support querying any set of tasks and dynamically filtering out
    // ones the user doesn't have access to.
    const isMissingRequiredFilters = useMemo(() => {
        if (!filters) return false;
        return isTaskQueryMissingRequiredFilters(currentAccount.id, filters);
    }, [currentAccount.id, filters]);

    const [queryState, setQueryState] = useState<TaskQueryState>({
        activeQuery: initialQuery
            ? {isAvailable: true, query: initialQuery}
            : {isAvailable: false, isMissingRequiredFilters, query: null},
        pendingQuery: null,
        // Should change whenever `activeQuery` changes.
        initialGridViewExpansionState,
        initialBottomGhostTaskId,
    });

    // Make sure the queries in `queryState` stay retained during this
    // component's lifetime.
    useEffect(() => {
        queryState.activeQuery.query?.retain();
        queryState.pendingQuery?.retain();

        return () => {
            // Release after a microtask in case the component is re-rendering which will
            // synchronously call `retain()` again.
            scheduleMicrotask(() => {
                batchStoreUpdates(() => {
                    queryState.activeQuery.query?.release();
                    queryState.pendingQuery?.release();
                });
            });
        };
    }, [queryState.pendingQuery, queryState.activeQuery]);

    // If the filters/sorts set by the user differ from the filters/sorts of the
    // active query we're presenting then we need to start a new pending query in the
    // background we'll swap out.
    useEffect(() => {
        const actualActiveQuery = queryState.activeQuery.isAvailable
            ? {
                  isAvailable: true as const,
                  query: {
                      filters: queryState.activeQuery.query.filters,
                      sorts: queryState.activeQuery.query.sorts,
                  },
              }
            : {
                  isAvailable: false as const,
                  isMissingRequiredFilters: queryState.activeQuery.isMissingRequiredFilters,
                  query: null,
              };

        const actualPendingQuery = queryState.pendingQuery
            ? {filters: queryState.pendingQuery.filters, sorts: queryState.pendingQuery.sorts}
            : null;

        const expectedQuery =
            filters && !isMissingRequiredFilters
                ? {
                      isAvailable: true as const,
                      query: {
                          filters,
                          sorts,
                      },
                  }
                : {
                      isAvailable: false as const,
                      isMissingRequiredFilters: cast<boolean>(isMissingRequiredFilters),
                      query: null,
                  };

        // Make sure comparing with `isDeepEqual()` is ok by checking that the types
        // are equal.
        assertEqualTypes<typeof actualActiveQuery, typeof expectedQuery>();
        assertEqualTypes<typeof actualPendingQuery, (typeof expectedQuery)["query"]>();

        // If our filters/sorts do not equal the active query or the pending query then
        // we need to start a new pending query.
        if (isDeepEqual(actualActiveQuery, expectedQuery)) return;

        if (!expectedQuery.isAvailable) {
            setQueryState({
                activeQuery: expectedQuery,
                pendingQuery: null,
                initialGridViewExpansionState: null,
                initialBottomGhostTaskId: generateId(),
            });
            return;
        }

        if (isDeepEqual(actualPendingQuery, expectedQuery.query)) return;

        const newPendingQuery = batchStoreUpdates(() => {
            const newPendingQuery = store.createAndRetainQuery({
                filters: expectedQuery.query.filters,
                sorts: expectedQuery.query.sorts,
            });
            newPendingQuery.loadMoreTasks(
                getTaskGridViewLoadQueryLimit(getClientInfoWithoutListening()),
            );

            // This needs to be called in `batchStoreUpdates()` since it delays our
            // `TaskRealtimeClient` subscribing to the query.
            getTaskRealtimeClientIfExistsForClient(
                space.id,
            )?.setShouldLoadGridViewExpansionStateForQuery(newPendingQuery);

            return newPendingQuery;
        });

        setQueryState({
            activeQuery: queryState.activeQuery,
            pendingQuery: newPendingQuery,
            initialGridViewExpansionState: queryState.initialGridViewExpansionState,
            initialBottomGhostTaskId: queryState.initialBottomGhostTaskId,
        });

        return () => {
            // Release after a microtask since when the component re-renders we
            // synchronously call `retain()` in the above hook keeping the query alive.
            scheduleMicrotask(() => {
                newPendingQuery.release();
            });
        };
    }, [filters, isMissingRequiredFilters, queryState, sorts, space.id, store]);

    // Once the pending query has finished loading, swap it out as the new
    // active query.
    useEffect(() => {
        if (!queryState.pendingQuery) return;
        const {pendingQuery} = queryState;

        const pendingQueryPromise = pendingQuery.waitForLoaded();

        let isCancelled = false;

        // TODO(calebmer, #global-loading-indicator): Add a loading spinner while we
        // wait for the pending query to load.
        pendingQueryPromise.finally(() => {
            if (isCancelled) return;

            // Don't animate when changing the query.
            disableAllTaskGridViewAnimationsUntilNextBrowserPaint();

            setQueryState({
                activeQuery: {isAvailable: true, query: pendingQuery},
                pendingQuery: null,
                initialGridViewExpansionState:
                    getTaskRealtimeClientIfExistsForClient(
                        space.id,
                    )?.takeInitialGridViewExpansionStateForQueryIfExists(pendingQuery) ?? null,
                initialBottomGhostTaskId: generateId(),
            });
        });

        return () => {
            isCancelled = true;
        };
    }, [queryState, space.id]);

    return queryState;
}
