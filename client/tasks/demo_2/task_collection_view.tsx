import {useEffect, useRef, useState} from "react";
import {Box} from "~/client/design/box.js";
import {OverlayScopeContextProvider} from "~/client/design/overlay.js";
import {TaskCollectionGridView} from "~/client/tasks/demo_2/internal/task_collection_grid_view.js";
import {TaskCollectionViewHeader} from "~/client/tasks/demo_2/internal/task_collection_view_header.js";
import {TaskQueryViewCustomizationBar} from "~/client/tasks/demo_2/internal/task_query_view_customization_bar.js";
import {
    LocalTaskCollection,
    LocalTasksAction,
    LocalTasksState,
} from "~/client/tasks/demo_2/local_tasks_state.js";
import {TaskGridPresentationalViewRef} from "~/client/tasks/demo_2/task_grid_presentational_view.js";
import {TaskQuerySort} from "~/shared/tasks/task_query_sort.js";
import {useOutOfBoundsClickSelection} from "~/client/tasks/internal/use_out_of_bounds_click_selection.js";
import {themeColors} from "~/shared/design/theme_colors.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {randomInteger} from "~/shared/helpers/number/random_integer.js";
import {LocalTaskCollectionId} from "~/shared/id/types/id_types.js";
import {tasksStyles} from "~/shared/styles/styles.js";
import {TaskQueryFilter} from "~/shared/tasks/task_query_filter.js";
import {
    TaskQueryFilterReferences,
    mergeTaskQueryFilterReferences,
} from "~/shared/tasks/task_query_filter_references.js";

export function TaskCollectionView({
    state,
    dispatch,
    collectionId,
    initialIsCreating,
    initialFilters,
    initialFilterReferences,
    onFiltersChange,
    initialSorts,
    onSortsChange,
}: {
    state: LocalTasksState;
    dispatch: (action: LocalTasksAction) => void;
    collectionId: LocalTaskCollectionId;
    initialIsCreating: boolean;
    initialFilters: ReadonlyArray<TaskQueryFilter>;
    initialFilterReferences: TaskQueryFilterReferences;
    onFiltersChange: (filters: ReadonlyArray<TaskQueryFilter>) => void;
    initialSorts: ReadonlyArray<TaskQuerySort>;
    onSortsChange: (sorts: ReadonlyArray<TaskQuerySort>) => void;
}) {
    const gridViewRef = useRef<TaskGridPresentationalViewRef>(null);

    const [optimisticCollection, setOptimisticCollection] = useState(
        (): Pick<LocalTaskCollection, "id" | "name" | "color"> | null => {
            if (!initialIsCreating) return null;

            return {
                id: collectionId,
                name: "",
                color: themeColors[randomInteger(themeColors.length)]!,
            };
        },
    );

    const collection = optimisticCollection ?? state.database.getTaskCollection(collectionId);

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
                <TaskCollectionViewHeader
                    collection={collection}
                    onCollectionNameChange={name => {
                        if (optimisticCollection) {
                            dispatch({
                                type: "CreateTaskCollection",
                                id: collection.id,
                                name,
                                color: collection.color,
                            });

                            setOptimisticCollection(null);
                        } else {
                            dispatch({
                                type: "UpdateTaskCollectionName",
                                taskCollectionId: collection.id,
                                name,
                            });
                        }
                    }}
                />
                <Box paddingX="5" paddingBottom="6">
                    <TaskQueryViewCustomizationBar
                        shouldCollapseWhenFiltersAreEmpty={true}
                        defaultOrderSentence="You can order tasks manually by dragging them."
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
                <TaskCollectionGridView
                    ref={gridViewRef}
                    state={state}
                    dispatch={dispatch}
                    collectionId={collectionId}
                    filters={filters}
                    sorts={sorts}
                />
            </OverlayScopeContextProvider>
        </Box>
    );
}
