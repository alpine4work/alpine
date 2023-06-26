import {useEffect, useState} from "react";
import {useParams, useSearchParams} from "react-router-dom";
import TasksViewRouteWrapper from "~/app/routes/s/$space_id/tasks/demo-2/view.js";
import {useIsInitialAppRender} from "~/client/helpers/lifecycle/use_is_initial_app_render.js";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema.js";
import {useLocalTasksState} from "~/client/tasks/demo_2/local_tasks_state.js";
import {TaskCollectionView} from "~/client/tasks/demo_2/task_collection_view.js";
import {
    deserializeTaskQuerySortsSearchParam,
    serializeTaskQuerySortsSearchParam,
} from "~/client/tasks/demo_2/task_query_sort.js";
import {getTaskQueryFilterReferences} from "~/server/dynamo/helpers/get_task_query_filter_references.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {LocalTaskCollectionId, SpaceId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";
import {
    deserializeTaskQueryFiltersSearchParam,
    serializeTaskQueryFiltersSearchParam,
} from "~/shared/tasks/task_query_filter.js";
import {TaskQueryFilterReferencesSchema} from "~/shared/tasks/task_query_filter_references.js";

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

export default function TaskCollectionRoute() {
    const collectionId = Schema.id<LocalTaskCollectionId>().deserialize(
        useParams()["task_collection_id"] ?? null,
    );

    return (
        <TaskCollectionRouteInner
            // Remount when the collection changes...
            key={collectionId}
            collectionId={collectionId}
        />
    );
}

function TaskCollectionRouteInner({collectionId}: {collectionId: LocalTaskCollectionId}) {
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

    const [initialIsCreating] = useState(() => searchParams.has("create"));

    // Remove the `create` search param on mount.
    useEffect(() => {
        const url = new URL(window.location.href);

        if (url.searchParams.has("create")) {
            url.searchParams.delete("create");

            // Silently update the URL without telling Remix so our component doesn't
            // re-render unnecessarily.
            window.history.replaceState(null, "", url);
        }
    }, []);

    const {filterReferences} = useLoaderDataWithSchema(LoaderSchema);
    const [state, dispatch] = useLocalTasksState();

    const isInitialAppRender = useIsInitialAppRender();

    // TODO(calebmer): A production implementation should not remount everything on
    // initial render!
    if (isInitialAppRender) return <TasksViewRouteWrapper />;

    return (
        <TaskCollectionView
            state={state}
            dispatch={dispatch}
            collectionId={collectionId}
            initialIsCreating={initialIsCreating}
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
