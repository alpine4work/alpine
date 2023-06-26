import {useState} from "react";
import {useLocation, useSearchParams} from "react-router-dom";
import {useIsInitialAppRender} from "~/client/helpers/lifecycle/use_is_initial_app_render";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema";
import {useLocalTasksState} from "~/client/tasks/demo_2/local_tasks_state";
import {
    deserializeTaskQuerySortsSearchParam,
    serializeTaskQuerySortsSearchParam,
} from "~/client/tasks/demo_2/task_query_sort";
import {TaskQueryView} from "~/client/tasks/demo_2/task_query_view";
import {getTaskQueryFilterReferences} from "~/server/dynamo/helpers/get_task_query_filter_references";
import {jsonWithSchema} from "~/server/remix/json_with_schema";
import {LoaderArgs} from "~/server/remix/loader_context";
import {SpaceId} from "~/shared/id/types/id_types";
import {Schema} from "~/shared/schema/schema";
import {
    deserializeTaskQueryFiltersSearchParam,
    serializeTaskQueryFiltersSearchParam,
} from "~/shared/tasks/task_query_filter";
import {TaskQueryFilterReferencesSchema} from "~/shared/tasks/task_query_filter_references";

const LoaderSchema = Schema.object({
    filterReferences: TaskQueryFilterReferencesSchema,
});

export async function loader({request, params, context}: LoaderArgs) {
    const url = new URL(request.url);
    const filtersString = url.searchParams.get("filter");
    const filters = filtersString ? deserializeTaskQueryFiltersSearchParam(filtersString) : [];
    const spaceId = Schema.id<SpaceId>().deserialize(params.space_id ?? null);

    const filterReferences = await getTaskQueryFilterReferences(
        await context.actor.authenticate(),
        spaceId,
        filters,
    );

    return jsonWithSchema(LoaderSchema, {filterReferences});
}

export default function TasksViewRouteWrapper() {
    const location = useLocation();

    return (
        <TasksViewRoute
            // Remount the route whenever the user navigates. As represented by the
            // location key changing.
            //
            // We want to read the new filters from the URL.
            key={location.key}
        />
    );
}

function TasksViewRoute() {
    const [searchParams] = useSearchParams();

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

    const {filterReferences} = useLoaderDataWithSchema(LoaderSchema);
    const [state, dispatch] = useLocalTasksState();

    const isInitialAppRender = useIsInitialAppRender();

    return (
        <TaskQueryView
            // TODO(calebmer): A production implementation should not remount everything on
            // initial render!
            key={`${isInitialAppRender}`}
            state={state}
            dispatch={dispatch}
            initialFilters={isInitialAppRender ? [] : initialFilters}
            initialFilterReferences={filterReferences}
            onFiltersChange={filters => {
                const url = new URL(window.location.href);

                if (filters.length === 0) {
                    url.searchParams.delete("filter");
                } else {
                    url.searchParams.set("filter", serializeTaskQueryFiltersSearchParam(filters));
                }

                // Silently update the URL without telling Remix so our component doesn't
                // re-render unnecessarily.
                window.history.replaceState(null, "", url);
            }}
            initialSorts={isInitialAppRender ? [] : initialSorts}
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
    );
}
