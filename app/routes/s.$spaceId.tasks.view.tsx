import {useState} from "react";
import {useLocation} from "react-router";
import {useSearchParams} from "react-router-dom";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema.js";
import {TaskQueryView} from "~/client/tasks/task_query_view.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {getTaskQueryFilterReferences} from "~/server/tasks/data/get_task_query_filter_references.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";
import {
    deserializeTaskQueryFiltersSearchParam,
    serializeTaskQueryFiltersSearchParam,
} from "~/shared/tasks/task_query_filter.js";
import {TaskQueryFilterReferencesSchema} from "~/shared/tasks/task_query_filter_references.js";
import {
    deserializeTaskQuerySortsSearchParam,
    serializeTaskQuerySortsSearchParam,
} from "~/shared/tasks/task_query_sort.js";

const LoaderSchema = Schema.object({
    filterReferences: TaskQueryFilterReferencesSchema,
});

export async function loader({request, params, context}: LoaderArgs) {
    const url = new URL(request.url);
    const filtersString = url.searchParams.get("filter");
    const filters = filtersString ? deserializeTaskQueryFiltersSearchParam(filtersString) : [];
    const spaceId = Schema.id<SpaceId>().deserialize(params.spaceId ?? null);

    const filterReferences = await getTaskQueryFilterReferences(
        (await context.actor.authenticate()).actor.authorizeSession(),
        spaceId,
        filters,
    );

    return jsonWithSchema(LoaderSchema, {filterReferences});
}

export function clientLoader() {
    // NOCOMMIT
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
        <TaskQueryView
            initialFilters={initialFilters}
            initialFilterReferences={initialFilterReferences}
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
            initialSorts={initialSorts}
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
