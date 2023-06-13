import {DotsThree} from "phosphor-react";
import {useEffect, useRef, useState} from "react";
import {Box} from "~/client/design/box";
import {IconButton} from "~/client/design/icon_button";
import {MenuButton} from "~/client/design/menu_button";
import {TaskQueryGridView} from "~/client/tasks/demo_2/internal/task_query_grid_view";
import {TaskQueryViewCustomizationBar} from "~/client/tasks/demo_2/internal/task_query_view_customization_bar";
import {LocalTasksAction, LocalTasksState} from "~/client/tasks/demo_2/local_tasks_state";
import {TaskQueryFilter} from "~/client/tasks/demo_2/task_query_filter";
import {LocalTaskCollectionId} from "~/shared/id/types/id_types";
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
            <TaskQueryGridView state={state} dispatch={dispatch} filters={filters} />
        </Box>
    );
}
