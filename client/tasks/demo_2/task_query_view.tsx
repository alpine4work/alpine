import {useEffect, useRef, useState} from "react";
import {Box} from "~/client/design/box";
import {Spacer} from "~/client/design/spacer";
import {TaskQueryGridView} from "~/client/tasks/demo_2/internal/task_query_grid_view";
import {TaskQueryViewCustomizationBar} from "~/client/tasks/demo_2/internal/task_query_view_customization_bar";
import {LocalTasksAction, LocalTasksState} from "~/client/tasks/demo_2/local_tasks_state";
import {TaskGridPresentationalViewRef} from "~/client/tasks/demo_2/task_grid_presentational_view";
import {TaskQueryFilter} from "~/client/tasks/demo_2/task_query_filter";
import {useOutOfBoundsClickSelection} from "~/client/tasks/internal/use_out_of_bounds_click_selection";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {tasksStyles} from "~/shared/styles/styles";
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
    const gridViewRef = useRef<TaskGridPresentationalViewRef>(null);

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
            className={tasksStyles.textCursorNotInheritedClassName}
            {...useOutOfBoundsClickSelection({
                onSelect: () => assertExists(gridViewRef.current).focusEnd(),
                onSelectAll: () => assertExists(gridViewRef.current).focusEnd(),
            })}
        >
            <Box paddingX="5">
                <TaskQueryViewCustomizationBar
                    shouldCollapseWhenFiltersAreEmpty={false}
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
            <TaskQueryGridView
                ref={gridViewRef}
                state={state}
                dispatch={dispatch}
                filters={filters}
            />
        </Box>
    );
}
