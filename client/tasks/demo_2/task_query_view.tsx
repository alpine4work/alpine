import {useEffect, useRef, useState} from "react";
import {Box} from "~/client/design/box";
import {Spacer} from "~/client/design/spacer";
import {TaskQueryGridView} from "~/client/tasks/demo_2/internal/task_query_grid_view";
import {TaskQueryViewCustomizationBar} from "~/client/tasks/demo_2/internal/task_query_view_customization_bar";
import {LocalTasksAction, LocalTasksState} from "~/client/tasks/demo_2/local_tasks_state";
import {TaskQueryFilter} from "~/client/tasks/demo_2/task_query_filter";
import {
    TaskQueryFilterReferences,
    mergeTaskQueryFilterReferences,
} from "~/shared/tasks/task_query_filter_references";

export function TaskQueryView({
    state,
    dispatch,
    initialFilters,
    onFiltersChange,
    initialFilterReferences,
}: {
    state: LocalTasksState;
    dispatch: (action: LocalTasksAction) => void;
    initialFilters: ReadonlyArray<TaskQueryFilter>;
    initialFilterReferences: TaskQueryFilterReferences;
    onFiltersChange: (filters: ReadonlyArray<TaskQueryFilter>) => void;
}) {
    const [{filters, filterReferences}, setFiltersState] = useState({
        filters: initialFilters,
        filterReferences: initialFilterReferences,
    });

    const lastFiltersRef = useRef(initialFilters);
    useEffect(() => {
        if (lastFiltersRef.current !== filters) {
            onFiltersChange(filters);
            lastFiltersRef.current = filters;
        }
    }, [filters, onFiltersChange]);

    return (
        <Box
            flexGrow="1"
            position="relative"
            zIndex="0"
            backgroundColor="grey-0"
            paddingY="5"
            overflowY="scroll"
        >
            <Box paddingX="5">
                <TaskQueryViewCustomizationBar
                    state={state}
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
                />
            </Box>
            <Spacer space="5" />
            <TaskQueryGridView state={state} dispatch={dispatch} filters={filters} />
        </Box>
    );
}
