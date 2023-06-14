import {DotsThree} from "phosphor-react";
import {useEffect, useRef, useState} from "react";
import {Box} from "~/client/design/box";
import {IconButton} from "~/client/design/icon_button";
import {MenuButton} from "~/client/design/menu_button";
import {TaskCollectionGridView} from "~/client/tasks/demo_2/internal/task_collection_grid_view";
import {TaskQueryViewCustomizationBar} from "~/client/tasks/demo_2/internal/task_query_view_customization_bar";
import {LocalTasksAction, LocalTasksState} from "~/client/tasks/demo_2/local_tasks_state";
import {TaskGridPresentationalViewRef} from "~/client/tasks/demo_2/task_grid_presentational_view";
import {TaskQueryFilter} from "~/client/tasks/demo_2/task_query_filter";
import {useOutOfBoundsClickSelection} from "~/client/tasks/internal/use_out_of_bounds_click_selection";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {LocalTaskCollectionId} from "~/shared/id/types/id_types";
import {tasksStyles} from "~/shared/styles/styles";
import {
    TaskQueryFilterReferences,
    mergeTaskQueryFilterReferences,
} from "~/shared/tasks/task_query_filter_references";

export function TaskCollectionView({
    state,
    dispatch,
    collectionId,
    initialFilters,
    onFiltersChange,
    initialFilterReferences,
}: {
    state: LocalTasksState;
    dispatch: (action: LocalTasksAction) => void;
    collectionId: LocalTaskCollectionId;
    initialFilters: ReadonlyArray<TaskQueryFilter>;
    initialFilterReferences: TaskQueryFilterReferences;
    onFiltersChange: (filters: ReadonlyArray<TaskQueryFilter>) => void;
}) {
    const gridViewRef = useRef<TaskGridPresentationalViewRef>(null);

    const collection = state.database.getTaskCollection(collectionId);

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
            paddingBottom="5"
            overflowY="scroll"
            className={tasksStyles.textCursorNotInheritedClassName}
            {...useOutOfBoundsClickSelection({
                onSelect: () => assertExists(gridViewRef.current).focusEnd(),
                onSelectAll: () => assertExists(gridViewRef.current).focusEnd(),
            })}
        >
            <Box
                paddingTop="5"
                paddingBottom="3"
                paddingX="5"
                display="flex"
                alignItems="center"
                gap="2"
            >
                <Box display="flex" alignItems="center" gap="1">
                    <Box display="flex" justifyContent="center" width="3">
                        <Box
                            // Carefully positioned so it aligns with the "+" icon in the
                            // "Add filter" button.
                            width="2"
                            height="2"
                            borderRadius="full"
                            backgroundColor={`${collection.color}-50-const`}
                        />
                    </Box>
                    <Box fontSize="200" fontStyle="truncate-semi-bold">
                        {collection.name}
                    </Box>
                </Box>
                <MenuButton
                    actions={[
                        {
                            label: "Copy link",
                            onPress: () => {
                                // NOCOMMIT
                            },
                        },
                        {
                            label: "Edit name",
                            onPress: () => {
                                // NOCOMMIT
                            },
                        },
                        {
                            label: "Edit color",
                            onPress: () => {
                                // NOCOMMIT
                            },
                        },
                    ]}
                >
                    <IconButton size="sm" description="More" withoutTooltip>
                        <DotsThree />
                    </IconButton>
                </MenuButton>
            </Box>
            <Box paddingX="5" paddingBottom="5">
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
                />
            </Box>
            <TaskCollectionGridView
                ref={gridViewRef}
                state={state}
                dispatch={dispatch}
                collectionId={collectionId}
                filters={filters}
            />
        </Box>
    );
}
