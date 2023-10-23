import {useState} from "react";
import {useLocation} from "react-router";
import {useSearchParams} from "react-router-dom";
import {createMetaFunction} from "~/client/remix/create_meta_function.js";
import {getCurrentDate} from "~/client/remix/use_current_time_rounded_to_hour.js";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema.js";
import {getTaskGridViewLoadQueryLimit} from "~/client/tasks/get_task_grid_view_load_query_limit.js";
import {TaskGridViewDndContext} from "~/client/tasks/task_grid_view_dnd_context.js";
import {TaskQueryView} from "~/client/tasks/task_query_view.js";
import {
    clientLoaderTaskStoreLoaderData,
    useTaskClientStore,
    useTaskStoreLoaderDataWithoutRetaining,
} from "~/client/tasks/task_realtime_client_context_provider.js";
import {isTaskQueryMissingRequiredFilters} from "~/client/tasks/use_task_query_state.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {getTaskQueryFilterReferences} from "~/server/tasks/data/get_task_query_filter_references.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {generateId} from "~/shared/id/id.js";
import {BrowserId, SpaceId, TaskId} from "~/shared/id/types/id_types.js";
import {Schema, SchemaSerializedObjectValue} from "~/shared/schema/schema.js";
import {TaskGridViewExpansionStateSchema} from "~/shared/tasks/task_grid_view_expansion_state.js";
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
    TaskQueryNormalizedSort,
    normalizeTaskQuerySorts,
} from "~/shared/tasks/task_query_normalized_sort.js";
import {
    deserializeTaskQuerySortsSearchParam,
    serializeTaskQuerySortsSearchParam,
} from "~/shared/tasks/task_query_sort.js";

const LoaderSchema = Schema.object({
    filterReferences: TaskQueryFilterReferencesSchema,
    initialGridViewExpansionState: TaskGridViewExpansionStateSchema,
    initialBottomGhostTaskId: Schema.id<TaskId>(),
});

export const meta = createMetaFunction(LoaderSchema, () => [{title: "Tasks"}]);

export async function loader({request, params, context: _context}: LoaderArgs) {
    const context = (await _context.actor.authenticate()).actor.authorizeSession();

    const url = new URL(request.url);
    const spaceId = Schema.id<SpaceId>().deserialize(params.spaceId ?? null);
    const filtersString = url.searchParams.get("filter");
    const filters = filtersString ? deserializeTaskQueryFiltersSearchParam(filtersString) : [];
    const sortsString = url.searchParams.get("sort");
    const sorts = sortsString ? deserializeTaskQuerySortsSearchParam(sortsString) : [];

    const normalizedFiltersResult = normalizeTaskQueryFilters(filters, {
        currentDate: getCurrentDate(context),
        currentAccountId: context.actor.getAccountId(),
    });

    const normalizedSorts = normalizeTaskQuerySorts(sorts);

    const [filterReferences, loadQueryResult] = await runAllPromises([
        getTaskQueryFilterReferences(context, spaceId, filters),
        (async () => {
            if (normalizedFiltersResult.type !== "Possible") return null;
            const {normalizedFilters} = normalizedFiltersResult;

            if (
                isTaskQueryMissingRequiredFilters(context.actor.getAccountId(), normalizedFilters)
            ) {
                return null;
            }

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
                collectionIds: [],
            });

            return Object.assign(result, {input: {query}});
        })(),
    ]);

    const queryOutput = loadQueryResult ? assertExists(loadQueryResult.queries[0]) : null;

    return jsonWithSchema(
        LoaderSchema,
        {
            filterReferences,
            initialGridViewExpansionState: queryOutput?.gridViewExpansionState ?? null,
            initialBottomGhostTaskId: generateId<TaskId>(),
        },
        {
            taskStoreLoaderData: loadQueryResult
                ? {
                      queries: [
                          {
                              limit: loadQueryResult.input.query.limit,
                              filters: loadQueryResult.input.query.filters,
                              sorts: loadQueryResult.input.query.sorts,
                              loadedState: assertExists(queryOutput).loadedState,
                          },
                          ...loadQueryResult.extraQueries,
                      ],
                      taskIds: [],
                      collectionIds: [],
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

export default function TaskQueryRoute() {
    const location = useLocation();

    return (
        <TaskQueryRouteInner
            // Remount the route whenever the user navigates. As represented by the
            // location key changing.
            //
            // We want to read the new filters from the URL.
            key={location.key}
        />
    );
}

function TaskQueryRouteInner() {
    const [searchParams] = useSearchParams();
    const {initialGridViewExpansionState, initialBottomGhostTaskId} =
        useLoaderDataWithSchema(LoaderSchema);
    const store = useTaskClientStore();
    const {
        queries: [initialQuery],
    } = useTaskStoreLoaderDataWithoutRetaining();

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

    const {filterReferences: initialFilterReferences} = useLoaderDataWithSchema(LoaderSchema);

    return (
        <TaskGridViewDndContext store={store}>
            <TaskQueryView
                store={store}
                initialQuery={
                    initialQuery
                        ? {
                              query: initialQuery,
                              initialGridViewExpansionState,
                              initialBottomGhostTaskId,
                          }
                        : null
                }
                initialFilters={initialFilters}
                initialFilterReferences={initialFilterReferences}
                initialSorts={initialSorts}
                onFiltersChange={filters => {
                    const url = new URL(window.location.href);

                    if (filters.length === 0) {
                        url.searchParams.delete("filter");
                    } else {
                        url.searchParams.set(
                            "filter",
                            serializeTaskQueryFiltersSearchParam(filters),
                        );
                    }

                    // Silently update the URL without telling Remix so our component doesn't
                    // re-render unnecessarily.
                    window.history.replaceState(null, "", url);
                }}
                onSortsChange={sorts => {
                    const url = new URL(window.location.href);

                    if (sorts.length === 0) {
                        url.searchParams.delete("sort");
                    } else {
                        url.searchParams.set("sort", serializeTaskQuerySortsSearchParam(sorts));
                    }

                    // Silently update the URL without telling Remix so our component doesn't
                    // re-render unnecessarily.
                    window.history.replaceState(null, "", url);
                }}
            />
        </TaskGridViewDndContext>
    );
}
