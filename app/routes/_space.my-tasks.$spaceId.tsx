import {CalendarDate, fromDate, toCalendarDate} from "@internationalized/date";
import {useCallback, useState} from "react";
import {ShouldRevalidateFunction} from "react-router";
import {useSearchParams} from "react-router-dom";
import {deserializeSpaceIdForLoader} from "~/app/helpers/deserialize_id_for_loader.js";
import {useTaskClientStoreSearchAffinityManager} from "~/app/helpers/use_task_client_store_search_entity_affinity_manager.js";
import {createMetaFunction} from "~/client/web/remix/create_meta_function.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {useTaskStoreLoaderDataWithoutRetaining} from "~/client/web/tasks/core/task_realtime_client_context_provider.js";
import {getTaskGridViewLoadQueryLimit} from "~/client/web/tasks/get_task_grid_view_load_query_limit.js";
import {
    createPersonalTaskViewDisplayStatusFilter,
    getPersonalTaskViewActiveSectionQueryFilters,
    getPersonalTaskViewClosedSectionQueryFilters,
    getPersonalTaskViewDueSoonSectionQueryFilters,
    getPersonalTaskViewDueTodaySectionQueryFilters,
    getPersonalTaskViewOverdueSectionQueryFilters,
    getPersonalTaskViewRemainingSectionQueryFilters,
    normalizeTaskPersonalViewSorts,
} from "~/client/web/tasks/get_task_personal_view_section_filters.js";
import {TaskGridViewDndContext} from "~/client/web/tasks/task_grid_view_dnd_context.js";
import {TaskPersonalView} from "~/client/web/tasks/task_personal_view.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {isSearchFavoriteEntity} from "~/server/search/data/table/search_entity_actions.js";
import {getTaskQueryFilterReferences} from "~/server/tasks/data/get_task_query_filter_references.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {isNonNullable} from "~/shared/helpers/control/is_non_nullable.open_source.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.open_source.js";
import {Tuple} from "~/shared/helpers/types/tuple.js";
import {BrowserId} from "~/shared/id/types/id_types.open_source.js";
import {Schema} from "~/shared/schema/schema.js";
import {TaskGridViewExpansionStateSchema} from "~/shared/tasks/task_grid_view_expansion_state.js";
import {TaskQueryEvaluationContext} from "~/shared/tasks/task_query_evaluation_context.js";
import {
    TaskQueryFilter,
    deserializeTaskQueryFiltersSearchParam,
    serializeTaskQueryFiltersSearchParam,
} from "~/shared/tasks/task_query_filter.js";
import {
    TaskQueryFilterReferencesSchema,
    emptyTaskQueryFilterReferences,
} from "~/shared/tasks/task_query_filter_references.js";
import {
    TaskQueryAccountNormalizedFilter,
    assertNonEmptyReadonlySet,
} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";
import {
    TaskQuerySort,
    deserializeTaskQuerySortsSearchParam,
    serializeTaskQuerySortsSearchParam,
} from "~/shared/tasks/task_query_sort.js";
import {TaskRealtimeLoadQueriesInputQuery} from "~/shared/tasks/task_realtime_service_procedure_schemas.js";

const LoaderSchema = Schema.object({
    // Which sections have queries (Active, Overdue, DueToday, DueSoon, Closed,
    // Remaining)
    sectionsPresent: Schema.tuple([
        Schema.boolean,
        Schema.boolean,
        Schema.boolean,
        Schema.boolean,
        Schema.boolean,
        Schema.boolean,
    ]),
    initialGridViewExpansionStates: Schema.tuple([
        TaskGridViewExpansionStateSchema,
        TaskGridViewExpansionStateSchema,
        TaskGridViewExpansionStateSchema,
        TaskGridViewExpansionStateSchema,
        TaskGridViewExpansionStateSchema,
        TaskGridViewExpansionStateSchema,
    ]),
    filterReferences: TaskQueryFilterReferencesSchema,
    isFavorite: Schema.boolean,
});

export const meta = createMetaFunction(LoaderSchema, () => [{title: "My tasks"}]);

export async function loader({request, params, context: unauthenticatedContext}: LoaderArgs) {
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();

    const url = new URL(request.url);
    const spaceId = deserializeSpaceIdForLoader(params.spaceId);

    const currentTime = new Date();
    const currentZonedDateTime = fromDate(currentTime, context.loader.getClientInfo().timeZone);
    const currentDate = toCalendarDate(currentZonedDateTime);

    // Parse filter and sort URL search params
    const filtersString = url.searchParams.get("filter");
    const filters = filtersString ? deserializeTaskQueryFiltersSearchParam(filtersString) : [];
    const sortsString = url.searchParams.get("sort");
    const sorts = sortsString ? deserializeTaskQuerySortsSearchParam(sortsString) : [];

    const assigneeFilter: TaskQueryAccountNormalizedFilter = {
        type: "OneOf",
        accountIds: assertNonEmptyReadonlySet(new Set([context.actor.getAccountId()])),
    };

    const queryLimit = getTaskGridViewLoadQueryLimit(context.loader.getClientInfo());
    const browserId = context.loader.getBrowserId();

    const normalizedSorts = normalizeTaskPersonalViewSorts(sorts, filters.length);

    const evaluationContext: TaskQueryEvaluationContext = {
        currentDate,
        currentAccountId: context.actor.getAccountId(),
    };

    const activeQuery = getTaskActiveQueryIfExists({
        userFilters: filters,
        evaluationContext,
        assigneeFilter,
        queryLimit,
        browserId,
        sorts: normalizedSorts,
    });

    const [overdueQuery, dueTodayQuery, dueSoonQuery, closedQuery, remainingQuery] =
        getNonActiveTaskQueriesIfExists({
            userFilters: filters,
            evaluationContext,
            assigneeFilter,
            currentDate,
            queryLimit,
            browserId,
            sorts: normalizedSorts,
        });

    // Build array of queries to load, tracking which sections are included
    const queriesToLoad = [
        activeQuery,
        overdueQuery,
        dueTodayQuery,
        dueSoonQuery,
        closedQuery,
        remainingQuery,
    ].filter(isNonNullable);

    const [{queries, extraQueries, updateEvent}, filterReferences, isFavorite] =
        await runAllPromises([
            context.tasks.loadQueries(spaceId, {
                queries: queriesToLoad,
                taskIds: [],
                collectionIds: [],
            }),
            filters.length > 0
                ? getTaskQueryFilterReferences(context, spaceId, filters)
                : emptyTaskQueryFilterReferences,
            isSearchFavoriteEntity(context, {spaceId, entityId: "TaskPersonal"}),
        ]);

    // Map query outputs back to sections
    let queryIndex = 0;
    const getQueryOutput = (query: unknown) => {
        if (query === null) return null;
        return assertExists(queries[queryIndex++]);
    };

    const activeQueryOutput = getQueryOutput(activeQuery);
    const overdueQueryOutput = getQueryOutput(overdueQuery);
    const dueTodayQueryOutput = getQueryOutput(dueTodayQuery);
    const dueSoonQueryOutput = getQueryOutput(dueSoonQuery);
    const closedQueryOutput = getQueryOutput(closedQuery);
    const remainingQueryOutput = getQueryOutput(remainingQuery);

    // Build taskStoreLoaderData queries array from non-null sections
    const taskStoreQueries = [
        activeQuery && activeQueryOutput
            ? {
                  limit: activeQuery.limit,
                  filters: activeQuery.filters,
                  sorts: activeQuery.sorts,
                  loadedState: activeQueryOutput.loadedState,
              }
            : null,
        overdueQuery && overdueQueryOutput
            ? {
                  limit: overdueQuery.limit,
                  filters: overdueQuery.filters,
                  sorts: overdueQuery.sorts,
                  loadedState: overdueQueryOutput.loadedState,
              }
            : null,
        dueTodayQuery && dueTodayQueryOutput
            ? {
                  limit: dueTodayQuery.limit,
                  filters: dueTodayQuery.filters,
                  sorts: dueTodayQuery.sorts,
                  loadedState: dueTodayQueryOutput.loadedState,
              }
            : null,
        dueSoonQuery && dueSoonQueryOutput
            ? {
                  limit: dueSoonQuery.limit,
                  filters: dueSoonQuery.filters,
                  sorts: dueSoonQuery.sorts,
                  loadedState: dueSoonQueryOutput.loadedState,
              }
            : null,
        closedQuery && closedQueryOutput
            ? {
                  limit: closedQuery.limit,
                  filters: closedQuery.filters,
                  sorts: closedQuery.sorts,
                  loadedState: closedQueryOutput.loadedState,
              }
            : null,
        remainingQuery && remainingQueryOutput
            ? {
                  limit: remainingQuery.limit,
                  filters: remainingQuery.filters,
                  sorts: remainingQuery.sorts,
                  loadedState: remainingQueryOutput.loadedState,
              }
            : null,
    ].filter(isNonNullable);

    // Empty expansion state for skipped sections
    const emptyExpansionState = emptyMap;

    return jsonWithSchema(
        LoaderSchema,
        {
            sectionsPresent: [
                activeQuery !== null,
                overdueQuery !== null,
                dueTodayQuery !== null,
                dueSoonQuery !== null,
                closedQuery !== null,
                remainingQuery !== null,
            ],
            initialGridViewExpansionStates: [
                activeQueryOutput?.gridViewExpansionState ?? emptyExpansionState,
                overdueQueryOutput?.gridViewExpansionState ?? emptyExpansionState,
                dueTodayQueryOutput?.gridViewExpansionState ?? emptyExpansionState,
                dueSoonQueryOutput?.gridViewExpansionState ?? emptyExpansionState,
                closedQueryOutput?.gridViewExpansionState ?? emptyExpansionState,
                remainingQueryOutput?.gridViewExpansionState ?? emptyExpansionState,
            ],
            filterReferences,
            isFavorite,
        },
        {
            taskStoreLoaderData: {
                queries: [...taskStoreQueries, ...extraQueries],
                taskIds: [],
                collectionIds: [],
                updateEvent,
            },
        },
    );
}

// We use `useTaskQueryState` to handle filter/sort changes client-side without
// loader calls. We only need to revalidate when the mode changes between Sections
// (no sorts) and Unified (has sorts), or when the base URL changes.
export const shouldRevalidate: ShouldRevalidateFunction = ({
    currentUrl: originalCurrentUrl,
    nextUrl: originalNextUrl,
}) => {
    const currentUrl = new URL(originalCurrentUrl);
    const nextUrl = new URL(originalNextUrl);

    // Filter and sort changes within the same mode are handled by useTaskQueryState,
    // so we don't need to revalidate for those.
    currentUrl.searchParams.delete("filter");
    currentUrl.searchParams.delete("sort");
    nextUrl.searchParams.delete("filter");
    nextUrl.searchParams.delete("sort");

    return nextUrl.toString() !== currentUrl.toString();
};

export default function TasksRoute() {
    const result = useLoaderDataWithSchema(LoaderSchema);

    const [searchParams, setSearchParams] = useSearchParams();

    // Parse initial filters and sorts from loader data to ensure SSR/client
    // consistency
    const [initialFilters] = useState((): ReadonlyArray<TaskQueryFilter> => {
        const filtersString = searchParams.get("filter");
        if (!filtersString) return [];
        return deserializeTaskQueryFiltersSearchParam(filtersString);
    });

    const [initialSorts] = useState((): ReadonlyArray<TaskQuerySort> => {
        const sortsString = searchParams.get("sort");
        if (!sortsString) return [];
        return deserializeTaskQuerySortsSearchParam(sortsString);
    });

    const handleFiltersChange = useCallback(
        (filters: ReadonlyArray<TaskQueryFilter>) => {
            const newSearchParams = new URLSearchParams(searchParams);

            if (filters.length === 0) {
                newSearchParams.delete("filter");
            } else {
                newSearchParams.set("filter", serializeTaskQueryFiltersSearchParam(filters));
            }

            setSearchParams(newSearchParams, {
                replace: true,
                // Don't revalidate when updating search params from here. We can't use the stable
                // `shouldRevalidate` route function because if the user navigates to a new URL we
                // want to load new data and re-render the route.
                unstable_shouldRevalidate: false,
            });
        },
        [searchParams, setSearchParams],
    );

    const handleSortsChange = useCallback(
        (sorts: ReadonlyArray<TaskQuerySort>) => {
            const newSearchParams = new URLSearchParams(searchParams);

            const currentHasSort = !!searchParams.get("sort");
            const nextHasSort = sorts.length > 0;

            if (sorts.length === 0) {
                newSearchParams.delete("sort");
            } else {
                newSearchParams.set("sort", serializeTaskQuerySortsSearchParam(sorts));
            }

            // Only revalidate when mode changes (sections <-> unified). Otherwise
            // useTaskQueryState handles sort changes client-side.
            const shouldRevalidate = currentHasSort !== nextHasSort;
            setSearchParams(newSearchParams, {
                replace: true,
                unstable_shouldRevalidate: shouldRevalidate,
            });
        },
        [searchParams, setSearchParams],
    );

    // We don't retain here since the components that consume our queries are expected
    // to retain them.
    const {store, queries} = useTaskStoreLoaderDataWithoutRetaining();

    const affinityManager = useTaskClientStoreSearchAffinityManager("TaskPersonal");

    // Sections mode - map queries to sections based on sectionsPresent
    const [
        isActivePresent,
        isOverduePresent,
        isDueTodayPresent,
        isDueSoonPresent,
        isClosedPresent,
        isRemainingPresent,
    ] = result.sectionsPresent;

    // Map the flat queries array back to section queries
    let queryIndex = 0;
    const activeQuery = isActivePresent ? queries[queryIndex++] : null;
    const overdueQuery = isOverduePresent ? queries[queryIndex++] : null;
    const dueTodayQuery = isDueTodayPresent ? queries[queryIndex++] : null;
    const dueSoonQuery = isDueSoonPresent ? queries[queryIndex++] : null;
    const closedQuery = isClosedPresent ? queries[queryIndex++] : null;
    const remainingQuery = isRemainingPresent ? queries[queryIndex++] : null;

    const [
        initialActiveGridViewExpansionState,
        initialOverdueGridViewExpansionState,
        initialDueTodayGridViewExpansionState,
        initialDueSoonGridViewExpansionState,
        initialClosedGridViewExpansionState,
        initialRemainingGridViewExpansionState,
    ] = result.initialGridViewExpansionStates;

    return (
        <TaskGridViewDndContext store={store}>
            <TaskPersonalView
                store={store}
                activeQuery={
                    activeQuery
                        ? {
                              query: activeQuery,
                              initialGridViewExpansionState: initialActiveGridViewExpansionState,
                          }
                        : null
                }
                overdueQuery={
                    overdueQuery
                        ? {
                              query: overdueQuery,
                              initialGridViewExpansionState: initialOverdueGridViewExpansionState,
                          }
                        : null
                }
                dueTodayQuery={
                    dueTodayQuery
                        ? {
                              query: dueTodayQuery,
                              initialGridViewExpansionState: initialDueTodayGridViewExpansionState,
                          }
                        : null
                }
                dueSoonQuery={
                    dueSoonQuery
                        ? {
                              query: dueSoonQuery,
                              initialGridViewExpansionState: initialDueSoonGridViewExpansionState,
                          }
                        : null
                }
                closedQuery={
                    closedQuery
                        ? {
                              query: closedQuery,
                              initialGridViewExpansionState: initialClosedGridViewExpansionState,
                          }
                        : null
                }
                remainingQuery={
                    remainingQuery
                        ? {
                              query: remainingQuery,
                              initialGridViewExpansionState: initialRemainingGridViewExpansionState,
                          }
                        : null
                }
                initialFilters={initialFilters}
                initialFilterReferences={result.filterReferences}
                onFiltersChange={handleFiltersChange}
                initialSorts={initialSorts}
                onSortsChange={handleSortsChange}
                affinityManager={affinityManager}
                initialIsFavorite={result.isFavorite}
            />
        </TaskGridViewDndContext>
    );
}

function getNonActiveTaskQueriesIfExists(options: {
    userFilters: ReadonlyArray<TaskQueryFilter>;
    evaluationContext: TaskQueryEvaluationContext;
    assigneeFilter: TaskQueryAccountNormalizedFilter;
    currentDate: CalendarDate;
    queryLimit: number;
    browserId: BrowserId;
    sorts: ReadonlyArray<TaskQueryNormalizedSort>;
}): Tuple<Extract<TaskRealtimeLoadQueriesInputQuery, {type: "Normalized"}> | null, 5> {
    // Non-active sections (Overdue, DueToday, DueSoon, Remaining) only show
    // OpenInactive tasks. Closed tasks are shown in their own dedicated Closed
    // section.
    const displayStatusFilter = createPersonalTaskViewDisplayStatusFilter(
        new Set(["OpenInactive"]),
    );

    const queryOptions = {
        ...options,
        displayStatusFilter,
        sorts: options.sorts,
    };

    return [
        getTaskOverdueQueryIfExists(queryOptions),
        getTaskDueTodayQueryIfExists(queryOptions),
        getTaskDueSoonQueryIfExists(queryOptions),
        getTaskClosedQueryIfExists(options),
        getTaskRemainingQueryIfExists(queryOptions),
    ];
}

function getTaskActiveQueryIfExists({
    userFilters,
    evaluationContext,
    assigneeFilter,
    queryLimit,
    browserId,
    sorts,
}: {
    userFilters: ReadonlyArray<TaskQueryFilter>;
    evaluationContext: TaskQueryEvaluationContext;
    assigneeFilter: TaskQueryAccountNormalizedFilter;
    queryLimit: number;
    browserId: BrowserId;
    sorts: ReadonlyArray<TaskQueryNormalizedSort>;
}) {
    const filters = getPersonalTaskViewActiveSectionQueryFilters({
        userFilters,
        evaluationContext,
        assigneeFilter,
    });

    if (!filters) return null;

    return {
        type: "Normalized" as const,
        limit: queryLimit,
        filters,
        sorts,
        shouldLoadGridViewExpandedChildTasksForBrowserId: browserId,
    };
}

function getTaskOverdueQueryIfExists({
    userFilters,
    evaluationContext,
    assigneeFilter,
    queryLimit,
    browserId,
    sorts,
    displayStatusFilter,
}: {
    userFilters: ReadonlyArray<TaskQueryFilter>;
    evaluationContext: TaskQueryEvaluationContext;
    assigneeFilter: TaskQueryAccountNormalizedFilter;
    queryLimit: number;
    browserId: BrowserId;
    sorts: ReadonlyArray<TaskQueryNormalizedSort>;
    displayStatusFilter: TaskQueryFilter;
}) {
    const filters = getPersonalTaskViewOverdueSectionQueryFilters({
        userFilters,
        evaluationContext,
        assigneeFilter,
        displayStatusFilter,
    });

    if (!filters) return null;

    return {
        type: "Normalized" as const,
        limit: queryLimit,
        filters,
        sorts,
        shouldLoadGridViewExpandedChildTasksForBrowserId: browserId,
    };
}

function getTaskDueTodayQueryIfExists({
    userFilters,
    evaluationContext,
    assigneeFilter,
    queryLimit,
    browserId,
    sorts,
    displayStatusFilter,
}: {
    userFilters: ReadonlyArray<TaskQueryFilter>;
    evaluationContext: TaskQueryEvaluationContext;
    assigneeFilter: TaskQueryAccountNormalizedFilter;
    queryLimit: number;
    browserId: BrowserId;
    sorts: ReadonlyArray<TaskQueryNormalizedSort>;
    displayStatusFilter: TaskQueryFilter;
}) {
    const filters = getPersonalTaskViewDueTodaySectionQueryFilters({
        userFilters,
        evaluationContext,
        assigneeFilter,
        displayStatusFilter,
    });

    if (!filters) return null;

    return {
        type: "Normalized" as const,
        limit: queryLimit,
        filters,
        sorts,
        shouldLoadGridViewExpandedChildTasksForBrowserId: browserId,
    };
}

function getTaskDueSoonQueryIfExists({
    userFilters,
    evaluationContext,
    assigneeFilter,
    queryLimit,
    browserId,
    sorts,
    displayStatusFilter,
}: {
    userFilters: ReadonlyArray<TaskQueryFilter>;
    evaluationContext: TaskQueryEvaluationContext;
    assigneeFilter: TaskQueryAccountNormalizedFilter;
    queryLimit: number;
    browserId: BrowserId;
    sorts: ReadonlyArray<TaskQueryNormalizedSort>;
    displayStatusFilter: TaskQueryFilter;
}) {
    const filters = getPersonalTaskViewDueSoonSectionQueryFilters({
        userFilters,
        evaluationContext,
        assigneeFilter,
        displayStatusFilter,
    });

    if (!filters) return null;

    return {
        type: "Normalized" as const,
        limit: queryLimit,
        filters,
        sorts,
        shouldLoadGridViewExpandedChildTasksForBrowserId: browserId,
    };
}

function getTaskRemainingQueryIfExists({
    userFilters,
    evaluationContext,
    assigneeFilter,
    queryLimit,
    browserId,
    sorts,
    displayStatusFilter,
    currentDate,
}: {
    userFilters: ReadonlyArray<TaskQueryFilter>;
    evaluationContext: TaskQueryEvaluationContext;
    assigneeFilter: TaskQueryAccountNormalizedFilter;
    queryLimit: number;
    browserId: BrowserId;
    sorts: ReadonlyArray<TaskQueryNormalizedSort>;
    displayStatusFilter: TaskQueryFilter;
    currentDate: CalendarDate;
}) {
    const filters = getPersonalTaskViewRemainingSectionQueryFilters({
        userFilters,
        evaluationContext,
        assigneeFilter,
        displayStatusFilter,
        currentDate,
    });

    if (!filters) return null;

    return {
        type: "Normalized" as const,
        limit: queryLimit,
        filters,
        sorts,
        shouldLoadGridViewExpandedChildTasksForBrowserId: browserId,
    };
}

function getTaskClosedQueryIfExists({
    userFilters,
    evaluationContext,
    assigneeFilter,
    queryLimit,
    browserId,
    sorts,
}: {
    userFilters: ReadonlyArray<TaskQueryFilter>;
    evaluationContext: TaskQueryEvaluationContext;
    assigneeFilter: TaskQueryAccountNormalizedFilter;
    queryLimit: number;
    browserId: BrowserId;
    sorts: ReadonlyArray<TaskQueryNormalizedSort>;
}) {
    const filters = getPersonalTaskViewClosedSectionQueryFilters({
        userFilters,
        evaluationContext,
        assigneeFilter,
    });

    if (!filters) return null;

    return {
        type: "Normalized" as const,
        limit: queryLimit,
        filters,
        sorts,
        shouldLoadGridViewExpandedChildTasksForBrowserId: browserId,
    };
}
