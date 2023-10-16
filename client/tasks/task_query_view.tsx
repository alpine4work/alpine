import {useEffect, useRef, useState} from "react";
import {Box} from "~/client/design/box.js";
import {TaskQueryViewCustomizationBar} from "~/client/tasks/internal/task_query_view_customization_bar.js";
import {useTaskClientStore} from "~/client/tasks/task_realtime_client_context_provider.js";
import {TaskQueryFilter} from "~/shared/tasks/task_query_filter.js";
import {
    TaskQueryFilterReferences,
    mergeTaskQueryFilterReferences,
} from "~/shared/tasks/task_query_filter_references.js";
import {TaskQuerySort} from "~/shared/tasks/task_query_sort.js";

export function TaskQueryView({
    initialFilters,
    initialFilterReferences,
    onFiltersChange,
    initialSorts,
    onSortsChange,
}: {
    initialFilters: ReadonlyArray<TaskQueryFilter>;
    initialFilterReferences: TaskQueryFilterReferences;
    onFiltersChange: (filters: ReadonlyArray<TaskQueryFilter>) => void;
    initialSorts: ReadonlyArray<TaskQuerySort>;
    onSortsChange: (sorts: ReadonlyArray<TaskQuerySort>) => void;
}) {
    // NOCOMMIT: Get store from query?
    const store = useTaskClientStore();

    const [{filters, filterReferences}, setFiltersState] = useState({
        filters: initialFilters,
        filterReferences: initialFilterReferences,
    });

    const lastFiltersRef = useRef(filters);
    useEffect(() => {
        if (lastFiltersRef.current !== filters) {
            onFiltersChange(filters);
            lastFiltersRef.current = filters;
        }
    }, [filters, onFiltersChange]);

    const [sorts, setSorts] = useState(initialSorts);

    const lastSortsRef = useRef(sorts);
    useEffect(() => {
        if (lastSortsRef.current !== sorts) {
            onSortsChange(sorts);
            lastSortsRef.current = sorts;
        }
    }, [onSortsChange, sorts]);

    return (
        <Box
            flexGrow="1"
            width="full"
            overflow="hidden"
            backgroundColor="grey-0"
            // NOCOMMIT
            // className={tasksStyles.textCursorNotInherited2ClassName}
            // {...useOutOfBoundsClickSelection({
            //     // Accept clicks on our `<VirtualizedScrollView>` child too.
            //     accept: event =>
            //         event.target === event.currentTarget ||
            //         (event.target instanceof Element &&
            //             event.target.parentElement === event.currentTarget),
            //     onSelect: () => focusGridViewEnd(),
            //     onSelectAll: () => focusGridViewEnd(),
            // })}
        >
            <Box paddingTop="5" paddingBottom="7" paddingX="5">
                <TaskQueryViewCustomizationBar
                    store={store}
                    shouldCollapseWhenFiltersAreEmpty={false}
                    defaultOrderSentence="By default, tasks are ordered by created date."
                    filters={filters}
                    filterReferences={filterReferences}
                    onFiltersChange={(filters, mergeFilterReferences) => {
                        setFiltersState(({filterReferences}) => {
                            const newFilterReferences = mergeFilterReferences
                                ? mergeTaskQueryFilterReferences(
                                      filterReferences,
                                      mergeFilterReferences,
                                  )
                                : filterReferences;

                            return {
                                filters,
                                filterReferences: newFilterReferences,
                            };
                        });
                    }}
                    sorts={sorts}
                    onSortsChange={setSorts}
                />
            </Box>
        </Box>
    );
}
