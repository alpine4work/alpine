import {useState} from "react";
import {useLocation, useSearchParams} from "react-router-dom";
import {Box} from "~/client/design/box";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema";
import {TaskQueryCustomizationBar} from "~/client/tasks/demo_2/task_query_customization_bar";
import {
    deserializeTaskQueryFiltersSearchParam,
    serializeTaskQueryFiltersSearchParam,
} from "~/client/tasks/demo_2/task_query_filter";
import {getTaskQueryFilterReferences} from "~/server/dynamo/helpers/get_task_query_filter_references";
import {jsonWithSchema} from "~/server/remix/json_with_schema";
import {LoaderArgs} from "~/server/remix/loader_context";
import {SpaceId} from "~/shared/id/types/id_types";
import {Schema} from "~/shared/schema/schema";
import {TaskQueryFilterReferencesSchema} from "~/shared/tasks/task_query_filter_references";

const LoaderSchema = Schema.object({
    filterReferences: TaskQueryFilterReferencesSchema,
});

export async function loader({request, params, context}: LoaderArgs) {
    const url = new URL(request.url);
    const filtersString = url.searchParams.get("filters");
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
        const filtersString = searchParams.get("filters");
        if (!filtersString) return [];
        return deserializeTaskQueryFiltersSearchParam(filtersString);
    });

    const {filterReferences} = useLoaderDataWithSchema(LoaderSchema);

    return (
        <Box flexGrow="1" position="relative" zIndex="0" backgroundColor="grey-0" padding="5">
            <TaskQueryCustomizationBar
                initialFilters={initialFilters}
                initialFilterReferences={filterReferences}
                onFiltersChange={filters => {
                    const url = new URL(window.location.href);

                    if (filters.length === 0) {
                        url.searchParams.delete("filters");
                    } else {
                        url.searchParams.set(
                            "filters",
                            serializeTaskQueryFiltersSearchParam(filters),
                        );
                    }

                    // Silently update the URL without telling Remix so our component doesn't
                    // re-render unnecessarily.
                    window.history.replaceState(null, "", url);
                }}
            />
        </Box>
    );
}
