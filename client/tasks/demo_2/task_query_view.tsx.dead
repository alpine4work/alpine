import {useEffect, useRef, useState} from "react";
import {Box} from "~/client/design/box.js";
import {OverlayScopeContextProvider} from "~/client/design/overlay.js";
import {TaskQueryGridView} from "~/client/tasks/demo_2/internal/task_query_grid_view.js";
import {TaskQueryViewCustomizationBar} from "~/client/tasks/demo_2/internal/task_query_view_customization_bar.js";
import {LocalTasksAction, LocalTasksState} from "~/client/tasks/demo_2/local_tasks_state.js";
import {TaskGridPresentationalViewRef} from "~/client/tasks/demo_2/task_grid_presentational_view.js";
import {TaskQuerySort} from "~/shared/tasks/task_query_sort.js";
import {useOutOfBoundsClickSelection} from "~/client/tasks/internal/use_out_of_bounds_click_selection.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {tasksStyles} from "~/shared/styles/styles.js";
import {TaskQueryFilter} from "~/shared/tasks/task_query_filter.js";
import {
    TaskQueryFilterReferences,
    mergeTaskQueryFilterReferences,
} from "~/shared/tasks/task_query_filter_references.js";

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
            <OverlayScopeContextProvider>
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
            </OverlayScopeContextProvider>
        </Box>
    );
}
