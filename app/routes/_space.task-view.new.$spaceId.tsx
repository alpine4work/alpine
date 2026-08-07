import {useState} from "react";
import {useSearchParams} from "react-router-dom";
import {deserializeSpaceIdForLoader} from "~/app/helpers/deserialize_id_for_loader.js";
import {useTaskClientStoreSearchAffinityManager} from "~/app/helpers/use_task_client_store_search_entity_affinity_manager.js";
import {createMetaFunction} from "~/client/web/remix/create_meta_function.js";
import {getCurrentDate} from "~/client/web/remix/use_current_time_rounded_to_hour.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {metaTitlePostfix, useUpdateMetaTitle} from "~/client/web/remix/use_update_meta_title.js";
import {defaultTaskQueryViewName} from "~/client/web/styles/tasks_shared_styles.js";
import {useTaskStoreLoaderDataWithoutRetaining} from "~/client/web/tasks/core/task_realtime_client_context_provider.js";
import {getTaskGridViewLoadQueryLimit} from "~/client/web/tasks/get_task_grid_view_load_query_limit.js";
import {TaskGridViewDndContext} from "~/client/web/tasks/task_grid_view_dnd_context.js";
import {TaskQueryView} from "~/client/web/tasks/task_query_view.js";
import {isTaskQueryMissingRequiredFilters} from "~/client/web/tasks/use_task_query_state.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {getTaskQueryFilterReferences} from "~/server/tasks/data/get_task_query_filter_references.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {BrowserId} from "~/shared/id/types/id_types.open_source.js";
import {Schema} from "~/shared/schema/schema.open_source.js";
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
    key: Schema.id(),
    filterReferences: TaskQueryFilterReferencesSchema,
    initialGridViewExpansionState: TaskGridViewExpansionStateSchema,
});

export const meta = createMetaFunction(LoaderSchema, ({location}) => {
    const searchParams = new URLSearchParams(location.search);
    const nameSearchParam = searchParams.get("name");
    return [{title: nameSearchParam ?? defaultTaskQueryViewName}];
});

export async function loader({request, params, context: _context}: LoaderArgs) {
    const context = (await _context.actor.authenticate()).actor.authorizeSession();

    const url = new URL(request.url);
    const spaceId = deserializeSpaceIdForLoader(params.spaceId);
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
                type: "Normalized";
                limit: number;
                filters: TaskQueryNormalizedFilters;
                sorts: ReadonlyArray<TaskQueryNormalizedSort>;
                shouldLoadGridViewExpandedChildTasksForBrowserId?: BrowserId;
            } = {
                type: "Normalized",
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
            key: generateId(),
            filterReferences,
            initialGridViewExpansionState: queryOutput?.gridViewExpansionState ?? null,
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

export default function TaskQueryRoute() {
    const {key} = useLoaderDataWithSchema(LoaderSchema);

    return (
        <TaskQueryRouteInner
            // Completely re-mount the route when we get new data from the server.
            key={key}
        />
    );
}

function TaskQueryRouteInner() {
    const updateMetaTitle = useUpdateMetaTitle();

    const [searchParams, setSearchParams] = useSearchParams();
    const {initialGridViewExpansionState} = useLoaderDataWithSchema(LoaderSchema);
    const {
        store,
        queries: [initialQuery],
    } = useTaskStoreLoaderDataWithoutRetaining();

    const [initialName] = useState(() => {
        return searchParams.get("name") ?? defaultTaskQueryViewName;
    });

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

    // We don't have an entity which can accrue affinity points when looking at a view.
    // Maybe in the future we should allow users to save named views that appear in
    // search?
    const affinityManager = useTaskClientStoreSearchAffinityManager(null);

    return (
        <TaskGridViewDndContext store={store}>
            <TaskQueryView
                store={store}
                affinityManager={affinityManager}
                initialQuery={
                    initialQuery
                        ? {
                              query: initialQuery,
                              initialGridViewExpansionState,
                          }
                        : null
                }
                initialName={initialName}
                onNameChange={name => {
                    const newSearchParams = new URLSearchParams(searchParams);

                    if (name === defaultTaskQueryViewName) {
                        newSearchParams.delete("name");
                    } else {
                        newSearchParams.set("name", name);
                    }

                    setSearchParams(newSearchParams, {
                        replace: true,
                        // Don't revalidate when updating search params from here. We can't use the stable
                        // `shouldRevalidate` route function because if the user navigates to a new URL we
                        // want to load new data and re-render the route.
                        unstable_shouldRevalidate: false,
                    });

                    updateMetaTitle(`${name}${metaTitlePostfix}`);
                }}
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
                        // Don't revalidate when updating search params from here. We can't use the stable
                        // `shouldRevalidate` route function because if the user navigates to a new URL we
                        // want to load new data and re-render the route.
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
                        // Don't revalidate when updating search params from here. We can't use the stable
                        // `shouldRevalidate` route function because if the user navigates to a new URL we
                        // want to load new data and re-render the route.
                        unstable_shouldRevalidate: false,
                    });
                }}
            />
        </TaskGridViewDndContext>
    );
}
