import {useEffect, useRef, useState} from "react";
import {Box} from "~/client/design/box";
import {TaskQueryGridView} from "~/client/tasks/demo_2/internal/task_query_grid_view";
import {TaskQueryViewCustomizationBar} from "~/client/tasks/demo_2/internal/task_query_view_customization_bar";
import {LocalTasksAction, LocalTasksState} from "~/client/tasks/demo_2/local_tasks_state";
import {TaskGridPresentationalViewRef} from "~/client/tasks/demo_2/task_grid_presentational_view";
import {TaskQueryFilter} from "~/client/tasks/demo_2/task_query_filter";
import {TaskQuerySort} from "~/client/tasks/demo_2/task_query_sort";
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
    initialFilterReferences,
    onFiltersChange,
    initialSorts,
    onSortsChange,
}: {
    state: LocalTasksState;
    dispatch: (action: LocalTasksAction) => void;
    initialFilters: ReadonlyArray<TaskQueryFilter>;
    initialFilterReferences: TaskQueryFilterReferences;
    onFiltersChange: (filters: ReadonlyArray<TaskQueryFilter>) => void;
    initialSorts: ReadonlyArray<TaskQuerySort>;
    onSortsChange: (sorts: ReadonlyArray<TaskQuerySort>) => void;
}) {
    const gridViewRef = useRef<TaskGridPresentationalViewRef>(null);

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
            position="relative"
            zIndex="0"
            backgroundColor="grey-0"
            paddingBottom="5"
            overflowY="scroll"
            className={tasksStyles.textCursorNotInheritedClassName}
            {...useOutOfBoundsClickSelection({
                onSelect: () => assertExists(gridViewRef.current).focusEnd(),
                onSelectAll: () => assertExists(gridViewRef.current).focusEnd(),
            })}
        >
            <Box paddingTop="5" paddingBottom="7" paddingX="5">
                <TaskQueryViewCustomizationBar
                    shouldCollapseWhenFiltersAreEmpty={false}
                    defaultOrderSentence="By default, tasks are ordered by created date."
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
                    sorts={sorts}
                    onSortsChange={setSorts}
                />
            </Box>
            <TaskQueryGridView
                ref={gridViewRef}
                state={state}
                dispatch={dispatch}
                filters={filters}
                sorts={sorts}
            />
        </Box>
    );
}
