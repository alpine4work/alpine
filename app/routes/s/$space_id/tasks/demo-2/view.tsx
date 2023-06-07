import {json} from "@remix-run/server-runtime";
import {useState} from "react";
import {useLocation, useSearchParams} from "react-router-dom";
import {Box} from "~/client/design/box";
import {TaskQueryCustomizationBar} from "~/client/tasks/demo_2/task_query_customization_bar";
import {
    deserializeTaskQueryFiltersSearchParam,
    serializeTaskQueryFiltersSearchParam,
} from "~/client/tasks/demo_2/task_query_filter";

export function loader() {
    return json({});
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

    return (
        <Box flexGrow="1" position="relative" zIndex="0" backgroundColor="grey-0" padding="5">
            <TaskQueryCustomizationBar
                initialFilters={initialFilters}
                onFiltersChange={filters => {
                    const url = new URL(window.location.href);

                    url.searchParams.set("filters", serializeTaskQueryFiltersSearchParam(filters));

                    // Silently update the URL without telling Remix so our component doesn't
                    // re-render unnecessarily.
                    window.history.replaceState(null, "", url);
                }}
            />
        </Box>
    );
}
