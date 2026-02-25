import {CalendarDate} from "@internationalized/date";
import {useEffect, useMemo, useState} from "react";
import {getClientInfo} from "~/client/web/remix/client_info_context.js";
import {useCurrentDate} from "~/client/web/remix/use_current_time_rounded_to_hour.js";
import {useAddGlobalLoadingIndicator} from "~/client/web/spaces/global_loading_indicator.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {indiscriminatelyDisableAllTaskGridViewAnimationsUntilNextBrowserPaint} from "~/client/web/tasks/core/disable_task_grid_view_animations_until_next_browser_paint.js";
import {TaskClientQuery} from "~/client/web/tasks/core/task_client_query.js";
import {TaskClientStore} from "~/client/web/tasks/core/task_client_store.js";
import {getTaskRealtimeClientIfExistsForClient} from "~/client/web/tasks/core/task_realtime_client_context_provider.js";
import {getTaskGridViewLoadQueryLimit} from "~/client/web/tasks/get_task_grid_view_load_query_limit.js";
import {
    createPersonalTaskViewDisplayStatusFilter,
    createTaskPersonalViewAssigneeFilter,
    getPersonalTaskViewActiveSectionQueryFilters,
    getPersonalTaskViewClosedSectionQueryFilters,
    getPersonalTaskViewDueSoonSectionQueryFilters,
    getPersonalTaskViewDueTodaySectionQueryFilters,
    getPersonalTaskViewOverdueSectionQueryFilters,
    getPersonalTaskViewRemainingSectionQueryFilters,
    normalizeTaskPersonalViewSorts,
} from "~/client/web/tasks/get_task_personal_view_section_filters.js";
import {isTaskQueryMissingRequiredFilters} from "~/client/web/tasks/use_task_query_state.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {stringifyForDeepEqualCheck} from "~/shared/helpers/control/stringify_for_deep_equal_check.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {batchStoreUpdates} from "~/shared/store/batch_store_updates.js";
import {TaskGridViewExpansionState} from "~/shared/tasks/task_grid_view_expansion_state.js";
import {TaskQueryEvaluationContext} from "~/shared/tasks/task_query_evaluation_context.js";
import {TaskQueryFilter} from "~/shared/tasks/task_query_filter.js";
import {TaskQueryNormalizedFilters} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";
import {TaskQuerySort} from "~/shared/tasks/task_query_sort.js";

export type TaskPersonalViewSectionQueryOptions = {
    query: TaskClientQuery;
    initialGridViewExpansionState: TaskGridViewExpansionState;
};

export type TaskPersonalViewQueryOptions = {
    readonly filters: TaskQueryNormalizedFilters | null;
    readonly sorts: ReadonlyArray<TaskQueryNormalizedSort>;
    readonly initialQuery: {
        readonly query: TaskClientQuery;
        readonly initialGridViewExpansionState: TaskGridViewExpansionState;
    } | null;
};

export type TaskQueryState = {
    readonly activeQuery:
        | {
              readonly isAvailable: true;
              readonly query: {
                  readonly query: TaskClientQuery;
                  readonly initialGridViewExpansionState: TaskGridViewExpansionState;
              };
          }
        | {
              readonly isAvailable: false;
              readonly isMissingRequiredFilters: boolean;
              readonly query: null;
          };
    readonly pendingQuery:
        | {
              isAvailable: true;
              query: TaskClientQuery;
          }
        | {isAvailable: false; isMissingRequiredFilters: boolean}
        | null;
};

type TaskPersonalViewQueryState = {
    queries: ReadonlyArray<TaskQueryState>;
    activeFilters: ReadonlyArray<TaskQueryFilter>;
    pendingFilters: ReadonlyArray<TaskQueryFilter> | null;
    activeSorts: ReadonlyArray<TaskQuerySort>;
    pendingSorts: ReadonlyArray<TaskQuerySort> | null;
};

/**
 * Hook that manages multiple task queries simultaneously and coordinates their
 * filter/sort changes.
 *
 * Unlike `useTaskQueryState` which manages a single query, this hook ensures
 * that when filters change, ALL queries wait until they've finished loading
 * before swapping from pending to active. This provides a smoother UX when
 * multiple sections need to update together.
 */
export function useTaskPersonalViewQueryState({
    filters,
    currentAccount,
    store,
    sorts,
    initialActiveQuery,
    initialOverdueQuery,
    initialDueTodayQuery,
    initialDueSoonQuery,
    initialclosedQuery,
    initialRemainingQuery,
}: {
    currentAccount: AccountModel;
    filters: ReadonlyArray<TaskQueryFilter>;
    store: TaskClientStore;
    sorts: ReadonlyArray<TaskQuerySort>;
    initialActiveQuery: TaskPersonalViewSectionQueryOptions | null;
    initialOverdueQuery: TaskPersonalViewSectionQueryOptions | null;
    initialDueTodayQuery: TaskPersonalViewSectionQueryOptions | null;
    initialDueSoonQuery: TaskPersonalViewSectionQueryOptions | null;
    initialclosedQuery: TaskPersonalViewSectionQueryOptions | null;
    initialRemainingQuery: TaskPersonalViewSectionQueryOptions | null;
}): {
    queries: ReadonlyArray<
        | (TaskPersonalViewSectionQueryOptions & {
              activeFilters: ReadonlyArray<TaskQueryFilter>;
          })
        | null
    >;
    activeFilters: ReadonlyArray<TaskQueryFilter>;
} {
    const {space} = useSpaceContext();
    const addGlobalLoadingIndicator = useAddGlobalLoadingIndicator();
    const currentDate = useCurrentDate();

    const queries = useMemo(() => {
        return getTaskPersonalViewSectionQueries({
            filters,
            sorts,
            currentAccount,
            currentDate,
            initialActiveQuery,
            initialOverdueQuery,
            initialDueTodayQuery,
            initialDueSoonQuery,
            initialclosedQuery,
            initialRemainingQuery,
        });
    }, [
        filters,
        sorts,
        currentAccount,
        currentDate,
        initialActiveQuery,
        initialOverdueQuery,
        initialDueTodayQuery,
        initialDueSoonQuery,
        initialclosedQuery,
        initialRemainingQuery,
    ]);

    // Initialize state for all queries
    const [queryStates, setQueryStates] = useState<TaskPersonalViewQueryState>({
        queries: queries.map(options => ({
            activeQuery: options.initialQuery
                ? {isAvailable: true, query: options.initialQuery}
                : {
                      isAvailable: false,
                      isMissingRequiredFilters: options.filters
                          ? isTaskQueryMissingRequiredFilters(currentAccount?.id, options.filters)
                          : false,
                      query: null,
                  },
            pendingQuery: null,
        })),
        activeFilters: filters,
        activeSorts: sorts,
        pendingFilters: null,
        pendingSorts: null,
    });

    // Make sure the queries in `queryStates` stay retained during this
    // component's lifetime.
    useEffect(() => {
        // Collect all queries that need to be retained (and later released)
        const queriesToRelease: Array<TaskClientQuery> = [];

        for (const {activeQuery, pendingQuery} of queryStates.queries) {
            if (activeQuery.query?.query) {
                activeQuery.query.query.retain();
                queriesToRelease.push(activeQuery.query.query);
            }

            if (pendingQuery?.isAvailable && pendingQuery?.query) {
                pendingQuery.query.retain();
                queriesToRelease.push(pendingQuery.query);
            }
        }

        return () => {
            // Release after a microtask in case the component is re-rendering which will
            // synchronously call `retain()` again.
            scheduleMicrotask(() => {
                batchStoreUpdates(() => {
                    for (const query of queriesToRelease) {
                        query.release();
                    }
                });
            });
        };
    }, [queryStates.queries]);

    // If the filters/sorts set by the user differ from the filters/sorts of the
    // active queries we're presenting then we need to start a new pending query
    // for each query whose filters/sorts have changed in the background we'll swap out.
    useEffect(() => {
        const queryStateQueriesUpdates: Array<TaskQueryState> = [];
        const createdPendingQueries: Array<TaskClientQuery> = [];
        let hasChanges = false;

        batchStoreUpdates(() => {
            for (let i = 0; i < queries.length; i++) {
                const {filters: newFilters, sorts: newSorts} = queries[i]!;
                const queryState = queryStates.queries[i]!;

                const isMissingRequiredFilters = newFilters
                    ? isTaskQueryMissingRequiredFilters(currentAccount?.id, newFilters)
                    : false;

                const currentActiveQuery = queryState.activeQuery.isAvailable
                    ? {
                          isAvailable: true as const,
                          query: {
                              filters: queryState.activeQuery.query.query.filters,
                              sorts: queryState.activeQuery.query.query.sorts,
                          },
                      }
                    : {
                          isAvailable: false as const,
                          isMissingRequiredFilters: queryState.activeQuery.isMissingRequiredFilters,
                          query: null,
                      };

                const currentPendingQuery = !queryState.pendingQuery
                    ? null
                    : queryState.pendingQuery.isAvailable
                      ? {
                            isAvailable: true as const,
                            query: {
                                filters: queryState.pendingQuery.query.filters,
                                sorts: queryState.pendingQuery.query.sorts,
                            },
                        }
                      : {
                            isAvailable: false as const,
                            isMissingRequiredFilters:
                                queryState.pendingQuery.isMissingRequiredFilters,
                            query: null,
                        };

                const newQuery =
                    newFilters && !isMissingRequiredFilters
                        ? {
                              isAvailable: true as const,
                              query: {
                                  filters: newFilters,
                                  sorts: newSorts,
                              },
                          }
                        : {
                              isAvailable: false as const,
                              isMissingRequiredFilters: cast<boolean>(isMissingRequiredFilters),
                              query: null,
                          };

                // Make sure comparing with `isDeepEqual()` is ok by checking that the types
                // are equal.
                assertEqualTypes<typeof currentActiveQuery, typeof newQuery>();
                assertEqualTypes<typeof currentPendingQuery, typeof newQuery | null>();

                // If our filters/sorts do not equal the active query or the pending query then
                // we need to start a new pending query.
                if (
                    stringifyForDeepEqualCheck<CalendarDate>(currentActiveQuery, date =>
                        date.toString(),
                    ) ===
                    stringifyForDeepEqualCheck<CalendarDate>(newQuery, date => date.toString())
                ) {
                    queryStateQueriesUpdates.push({
                        activeQuery: queryState.activeQuery,
                        pendingQuery: null,
                    });
                    continue;
                }

                // If pending already matches expected, keep it (no state update)
                if (
                    stringifyForDeepEqualCheck<CalendarDate>(currentPendingQuery, date =>
                        date.toString(),
                    ) ===
                    stringifyForDeepEqualCheck<CalendarDate>(newQuery, date => date.toString())
                ) {
                    queryStateQueriesUpdates.push({
                        activeQuery: queryState.activeQuery,
                        pendingQuery: queryState.pendingQuery,
                    });
                    continue;
                }

                hasChanges = true;

                if (!newQuery.isAvailable) {
                    queryStateQueriesUpdates.push({
                        activeQuery: queryState.activeQuery,
                        pendingQuery: newQuery,
                    });
                    continue;
                }

                const newPendingQuery = store.createAndRetainQuery({
                    filters: newQuery.query.filters,
                    sorts: newQuery.query.sorts,
                    limit: getTaskGridViewLoadQueryLimit(getClientInfo()),
                });

                // This needs to be called in `batchStoreUpdates()` since `batchStoreUpdates()`
                // delays our `TaskRealtimeClient` subscribing to the query. We want to wait
                // until after `setShouldLoadGridViewExpansionStateForQuery()` to subscribe so
                // that the realtime client can include the load-grid-view-expansion-state
                // flag as true when the subscription happens.
                getTaskRealtimeClientIfExistsForClient(
                    space.id,
                )?.setShouldLoadGridViewExpansionStateForQuery(newPendingQuery);

                queryStateQueriesUpdates.push({
                    activeQuery: queryState.activeQuery,
                    pendingQuery: {
                        isAvailable: true,
                        query: newPendingQuery,
                    },
                });
                createdPendingQueries.push(newPendingQuery);
            }
        });

        if (!hasChanges) return;

        setQueryStates({
            queries: queryStateQueriesUpdates,
            activeFilters: queryStates.activeFilters,
            activeSorts: queryStates.activeSorts,
            pendingFilters: filters,
            pendingSorts: sorts,
        });

        return () => {
            // Release after a microtask since when the component re-renders we
            // synchronously call `retain()` in the above hook keeping the query alive.
            scheduleMicrotask(() => {
                for (const query of createdPendingQueries) {
                    query.release();
                }
            });
        };
    }, [
        queries,
        currentAccount?.id,
        queryStates.queries,
        queryStates.activeFilters,
        queryStates.activeSorts,
        filters,
        sorts,
        space.id,
        store,
    ]);

    // Wait for ALL pending queries to load, then swap them all at once
    useEffect(() => {
        const pendingQueryEntries = filterMapArray(queryStates.queries, ({pendingQuery}, index) => {
            if (!pendingQuery) return undefined;

            return {index, pendingQuery};
        });

        if (pendingQueryEntries.length === 0) return;

        const cancelledPromiseResolver = createPromiseResolver();

        const allLoadedPromise = runAllPromises(
            filterMapArray(pendingQueryEntries, ({pendingQuery}) => {
                if (!pendingQuery.isAvailable) return undefined;

                return pendingQuery.query.waitForLoaded();
            }),
        );

        addGlobalLoadingIndicator(
            Promise.race([cancelledPromiseResolver.promise, allLoadedPromise]),
            {type: "Loading"},
        );

        void allLoadedPromise.finally(() => {
            if (cancelledPromiseResolver.isSettled()) return;

            // Don't animate when changing the query
            indiscriminatelyDisableAllTaskGridViewAnimationsUntilNextBrowserPaint();

            const newQueryStateQueries = [...queryStates.queries];
            for (const {index, pendingQuery} of pendingQueryEntries) {
                newQueryStateQueries[index] = {
                    activeQuery: pendingQuery.isAvailable
                        ? {
                              isAvailable: true,
                              query: {
                                  query: pendingQuery.query,
                                  initialGridViewExpansionState:
                                      getTaskRealtimeClientIfExistsForClient(
                                          space.id,
                                      )?.takeInitialGridViewExpansionStateForQueryIfExists(
                                          pendingQuery.query,
                                      ) ?? null,
                              },
                          }
                        : {
                              isAvailable: false,
                              isMissingRequiredFilters: pendingQuery.isMissingRequiredFilters,
                              query: null,
                          },
                    pendingQuery: null,
                };
            }

            // Use functional update to avoid stale closure - queryStates captured
            // when the effect ran may be outdated by the time the promise resolves.
            setQueryStates({
                queries: newQueryStateQueries,
                activeFilters: assertExists(queryStates.pendingFilters),
                activeSorts: assertExists(queryStates.pendingSorts),
                pendingFilters: null,
                pendingSorts: null,
            });
        });

        return () => {
            cancelledPromiseResolver.resolve();
        };
    }, [addGlobalLoadingIndicator, queryStates, space.id]);

    return {
        queries: queryStates.queries.map(queryState =>
            queryState.activeQuery.isAvailable
                ? {
                      ...queryState.activeQuery.query,
                      activeFilters: queryStates.activeFilters,
                  }
                : null,
        ),
        activeFilters: queryStates.activeFilters,
    };
}

function getTaskPersonalViewSectionQueries({
    filters,
    sorts,
    currentAccount,
    currentDate,
    initialActiveQuery,
    initialOverdueQuery,
    initialDueTodayQuery,
    initialDueSoonQuery,
    initialclosedQuery,
    initialRemainingQuery,
}: {
    filters: ReadonlyArray<TaskQueryFilter>;
    sorts: ReadonlyArray<TaskQuerySort>;
    currentAccount: AccountModel;
    currentDate: CalendarDate;
    initialActiveQuery: TaskPersonalViewSectionQueryOptions | null;
    initialOverdueQuery: TaskPersonalViewSectionQueryOptions | null;
    initialDueTodayQuery: TaskPersonalViewSectionQueryOptions | null;
    initialDueSoonQuery: TaskPersonalViewSectionQueryOptions | null;
    initialclosedQuery: TaskPersonalViewSectionQueryOptions | null;
    initialRemainingQuery: TaskPersonalViewSectionQueryOptions | null;
}): ReadonlyArray<TaskPersonalViewQueryOptions> {
    // If no filters or sorts have been explicitly set then the user can manually
    // sort by collection position.
    //
    // If the collection view is filtered we automatically apply a sort since there
    // can be some weirdness creating a task and expecting it to be in one place
    // when there's no filter but instead it goes to another place.
    const normalizedSorts: ReadonlyArray<TaskQueryNormalizedSort> = normalizeTaskPersonalViewSorts(
        sorts,
        filters.length,
    );

    const assigneeFilter = createTaskPersonalViewAssigneeFilter(currentAccount.id);

    const evaluationContext: TaskQueryEvaluationContext = {
        currentDate,
        currentAccountId: currentAccount.id,
    };

    // Compute normalized filters for each section based on current user filters.
    // In unified mode, only the "remaining" section is used with unified filters.
    // In sections mode, each section gets its own specific filters.
    const activeNormalizedFilters = getPersonalTaskViewActiveSectionQueryFilters({
        userFilters: filters,
        evaluationContext,
        assigneeFilter,
    });

    // Display status filter for non-active sections (Overdue, DueToday, DueSoon, Remaining).
    // These sections only show OpenInactive tasks. Closed tasks are shown in the dedicated
    // Closed section.
    const defaultInactiveTaskSectionFilters = {
        assigneeFilter,
        displayStatusFilter: createPersonalTaskViewDisplayStatusFilter(new Set(["OpenInactive"])),
    };

    const overdueNormalizedFilters = getPersonalTaskViewOverdueSectionQueryFilters({
        userFilters: filters,
        evaluationContext,
        ...defaultInactiveTaskSectionFilters,
    });

    const dueTodayNormalizedFilters = getPersonalTaskViewDueTodaySectionQueryFilters({
        userFilters: filters,
        evaluationContext,
        ...defaultInactiveTaskSectionFilters,
    });

    const dueSoonNormalizedFilters = getPersonalTaskViewDueSoonSectionQueryFilters({
        userFilters: filters,
        evaluationContext,
        ...defaultInactiveTaskSectionFilters,
    });

    const closedNormalizedFilters = getPersonalTaskViewClosedSectionQueryFilters({
        userFilters: filters,
        evaluationContext,
        assigneeFilter,
    });

    const remainingNormalizedFilters = getPersonalTaskViewRemainingSectionQueryFilters({
        userFilters: filters,
        evaluationContext,
        ...defaultInactiveTaskSectionFilters,
        currentDate: evaluationContext.currentDate,
    });

    // Build query configs for all sections
    return [
        {
            filters: activeNormalizedFilters,
            sorts: normalizedSorts,
            initialQuery: initialActiveQuery
                ? {
                      query: initialActiveQuery.query,
                      initialGridViewExpansionState:
                          initialActiveQuery.initialGridViewExpansionState,
                  }
                : null,
        },
        {
            filters: overdueNormalizedFilters,
            sorts: normalizedSorts,
            initialQuery: initialOverdueQuery
                ? {
                      query: initialOverdueQuery.query,
                      initialGridViewExpansionState:
                          initialOverdueQuery.initialGridViewExpansionState,
                  }
                : null,
        },
        {
            filters: dueTodayNormalizedFilters,
            sorts: normalizedSorts,
            initialQuery: initialDueTodayQuery
                ? {
                      query: initialDueTodayQuery.query,
                      initialGridViewExpansionState:
                          initialDueTodayQuery.initialGridViewExpansionState,
                  }
                : null,
        },
        {
            filters: dueSoonNormalizedFilters,
            sorts: normalizedSorts,
            initialQuery: initialDueSoonQuery
                ? {
                      query: initialDueSoonQuery.query,
                      initialGridViewExpansionState:
                          initialDueSoonQuery.initialGridViewExpansionState,
                  }
                : null,
        },
        {
            filters: closedNormalizedFilters,
            sorts: normalizedSorts,
            initialQuery: initialclosedQuery
                ? {
                      query: initialclosedQuery.query,
                      initialGridViewExpansionState:
                          initialclosedQuery.initialGridViewExpansionState,
                  }
                : null,
        },
        {
            filters: remainingNormalizedFilters,
            sorts: normalizedSorts,
            initialQuery: initialRemainingQuery
                ? {
                      query: initialRemainingQuery.query,
                      initialGridViewExpansionState:
                          initialRemainingQuery.initialGridViewExpansionState,
                  }
                : null,
        },
    ];
}
