import {Plus, SortAscending} from "phosphor-react";
import {useEffect, useRef, useState} from "react";
import {Box} from "~/client/design/box";
import {Button} from "~/client/design/button";
import {IconButton} from "~/client/design/icon_button";
import {MenuButton} from "~/client/design/menu_button";
import {TaskQueryFilterEditor} from "~/client/tasks/demo_2/internal/task_query_filter_editor";
import {TaskQueryFilter} from "~/client/tasks/demo_2/task_query_filter";
import {spacing} from "~/shared/design/spacing";
import {
    TaskQueryFilterReferences,
    mergeTaskQueryFilterReferences,
} from "~/shared/tasks/task_query_filter_references";

export function TaskQueryCustomizationBar({
    initialFilters,
    initialFilterReferences,
    onFiltersChange,
}: {
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

    const addFilter = (filter: TaskQueryFilter) => {
        setFiltersState(({filters, filterReferences}) => ({
            filters: [...filters, filter],
            filterReferences,
        }));
    };

    return (
        <Box display="flex" alignItems="flex-start">
            {filters.length > 0 && (
                <Box height="6" display="flex" alignItems="center" paddingLeft="2" paddingRight="3">
                    Filters:
                </Box>
            )}
            <Box flexGrow="1" display="flex" flexWrap="wrap" alignItems="center" gap="2">
                {filters.map((filter, index) => (
                    <TaskQueryFilterEditor
                        key={index}
                        filter={filter}
                        filterReferences={filterReferences}
                        onFilterChange={(filter, mergeFilterReferences) => {
                            setFiltersState(({filters, filterReferences}) => {
                                const newFilters = [...filters];
                                newFilters[index] = filter;

                                const newFilterReferences = mergeFilterReferences
                                    ? mergeTaskQueryFilterReferences(
                                          filterReferences,
                                          mergeFilterReferences,
                                      )
                                    : filterReferences;

                                return {
                                    filters: newFilters,
                                    filterReferences: newFilterReferences,
                                };
                            });
                        }}
                        onFilterRemove={() => {
                            setFiltersState(({filters, filterReferences}) => {
                                const newFilters = [...filters];
                                newFilters.splice(index, 1);
                                return {filters: newFilters, filterReferences};
                            });
                        }}
                    />
                ))}
                <MenuButton
                    actions={[
                        [
                            {
                                label: "Status",
                                onPress: () => {
                                    addFilter({
                                        type: "Status",
                                        operation: {
                                            type: "NoneOf",
                                            statuses: new Set(["Closed"]),
                                        },
                                    });
                                },
                            },
                            {
                                label: "Collection",
                                onPress: () => {
                                    addFilter({
                                        type: "Collections",
                                        operation: {
                                            type: "OneOf",
                                            collectionIds: new Set(),
                                        },
                                    });
                                },
                            },
                        ],
                        [
                            {
                                label: "Assignee",
                                onPress: () => {
                                    addFilter({
                                        type: "Assignee",
                                        operation: {
                                            type: "OneOf",
                                            accounts: [{type: "CurrentAccount"}],
                                        },
                                    });
                                },
                            },
                            {
                                label: "Creator",
                                onPress: () => {
                                    addFilter({
                                        type: "Creator",
                                        operation: {
                                            type: "OneOf",
                                            accounts: [{type: "CurrentAccount"}],
                                        },
                                    });
                                },
                            },
                            {
                                label: "Assigner",
                                onPress: () => {
                                    addFilter({
                                        type: "Assigner",
                                        operation: {
                                            type: "OneOf",
                                            accounts: [{type: "CurrentAccount"}],
                                        },
                                    });
                                },
                            },
                        ],
                        [
                            {
                                label: "Due date",
                                onPress: () => {
                                    addFilter({
                                        type: "DueDate",
                                        operation: {type: "Overdue"},
                                    });
                                },
                            },
                            {
                                label: "Created date",
                                onPress: () => {
                                    addFilter({
                                        type: "CreatedDate",
                                        operation: {
                                            type: "GreaterThanOrEqualTo",
                                            date: null,
                                        },
                                    });
                                },
                            },
                            {
                                label: "Assigned date",
                                onPress: () => {
                                    addFilter({
                                        type: "AssignedDate",
                                        operation: {
                                            type: "GreaterThanOrEqualTo",
                                            date: null,
                                        },
                                    });
                                },
                            },
                            {
                                label: "Closed date",
                                onPress: () => {
                                    addFilter({
                                        type: "ClosedDate",
                                        operation: {
                                            type: "GreaterThanOrEqualTo",
                                            date: null,
                                        },
                                    });
                                },
                            },
                            {
                                // NOTE(calebmer): I feel like "Active date" is better copy here than
                                // "Activated date" since it's more inline with "Active" task branding. I don't
                                // know if people will think of themselves as "activating" a task or more like
                                // "setting a task as active".
                                label: "Active date",
                                onPress: () => {
                                    addFilter({
                                        type: "ActivatedDate",
                                        operation: {
                                            type: "GreaterThanOrEqualTo",
                                            date: null,
                                        },
                                    });
                                },
                            },
                        ],
                    ]}
                >
                    {filters.length > 0 ? (
                        <IconButton size="sm" description="Add filter" withoutTooltip>
                            <Plus size={spacing["3"]} />
                        </IconButton>
                    ) : (
                        <Button icon={<Plus />} iconPlacement="end" height="6" paddingX="2">
                            Add filter
                        </Button>
                    )}
                </MenuButton>
            </Box>
            <Box paddingLeft="5">
                <Box borderLeft="grey-5" paddingLeft="5">
                    <Button icon={<SortAscending />} height="6" paddingX="2">
                        Sort
                    </Button>
                </Box>
            </Box>
        </Box>
    );
}
