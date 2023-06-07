import {Plus, SortAscending, X} from "phosphor-react";
import {useEffect, useRef, useState} from "react";
import {Box} from "~/client/design/box";
import {Button} from "~/client/design/button";
import {IconButton} from "~/client/design/icon_button";
import {MenuButton} from "~/client/design/menu_button";
import {TaskQueryFilter} from "~/client/tasks/demo_2/task_query_filter";
import {spacing} from "~/shared/design/spacing";

export function TaskQueryCustomizationBar({
    initialFilters,
    onFiltersChange,
}: {
    initialFilters: ReadonlyArray<TaskQueryFilter>;
    onFiltersChange: (filters: ReadonlyArray<TaskQueryFilter>) => void;
}) {
    const [filters, setFilters] = useState<ReadonlyArray<TaskQueryFilter>>(initialFilters);

    const lastFiltersRef = useRef(initialFilters);
    useEffect(() => {
        if (lastFiltersRef.current !== filters) {
            onFiltersChange(filters);
            lastFiltersRef.current = filters;
        }
    }, [filters, onFiltersChange]);

    return (
        <Box display="flex" alignItems="flex-start">
            {filters.length > 0 && (
                <Box height="6" display="flex" alignItems="center" paddingRight="3">
                    Filters:
                </Box>
            )}
            <Box flexGrow="1" display="flex" flexWrap="wrap" alignItems="center" gap="2">
                {filters.map((filter, index) => (
                    <Box
                        key={index}
                        height="6"
                        width="32"
                        display="flex"
                        alignItems="center"
                        paddingLeft="2"
                        borderRadius="base"
                        border="grey-10"
                    >
                        <Box flexGrow="1">{filter.type}</Box>
                        <Box
                            style={{
                                // Subtract 1px from our right padding since that's the border width. That will
                                // give us good margin on all sides of the button.
                                paddingRight: `calc(${spacing["1"]} - 1px)`,
                            }}
                        >
                            <IconButton
                                size="xs"
                                description="Remove"
                                withoutTooltip
                                borderRadius="sm"
                                onPress={() => {
                                    setFilters(filters => {
                                        const newFilters = [...filters];
                                        newFilters.splice(index, 1);
                                        return newFilters;
                                    });
                                }}
                            >
                                <X />
                            </IconButton>
                        </Box>
                    </Box>
                ))}
                <MenuButton
                    actions={[
                        [
                            {
                                label: "Status",
                                onPress: () => {
                                    setFilters(filters => [
                                        ...filters,
                                        {
                                            type: "Status",
                                            operation: {type: "OneOf", statuses: new Set()},
                                        },
                                    ]);
                                },
                            },
                            {
                                label: "Collection",
                                onPress: () => {
                                    setFilters(filters => [
                                        ...filters,
                                        {
                                            type: "Collections",
                                            operation: {type: "OneOf", collectionIds: new Set()},
                                        },
                                    ]);
                                },
                            },
                        ],
                        [
                            {
                                label: "Assignee",
                                onPress: () => {
                                    setFilters(filters => [
                                        ...filters,
                                        {
                                            type: "Assignee",
                                            operation: {
                                                type: "OneOf",
                                                accounts: [{type: "CurrentAccount"}],
                                            },
                                        },
                                    ]);
                                },
                            },
                            {
                                label: "Creator",
                                onPress: () => {
                                    setFilters(filters => [
                                        ...filters,
                                        {
                                            type: "Creator",
                                            operation: {
                                                type: "OneOf",
                                                accounts: [{type: "CurrentAccount"}],
                                            },
                                        },
                                    ]);
                                },
                            },
                            {
                                label: "Assigner",
                                onPress: () => {
                                    setFilters(filters => [
                                        ...filters,
                                        {
                                            type: "Assigner",
                                            operation: {
                                                type: "OneOf",
                                                accounts: [{type: "CurrentAccount"}],
                                            },
                                        },
                                    ]);
                                },
                            },
                        ],
                        [
                            {
                                label: "Due date",
                                onPress: () => {
                                    setFilters(filters => [
                                        ...filters,
                                        {type: "DueDate", operation: {type: "Overdue"}},
                                    ]);
                                },
                            },
                            {
                                label: "Created date",
                                onPress: () => {
                                    setFilters(filters => [
                                        ...filters,
                                        {
                                            type: "CreatedDate",
                                            operation: {type: "GreaterThanOrEqualTo", date: null},
                                        },
                                    ]);
                                },
                            },
                            {
                                label: "Assigned date",
                                onPress: () => {
                                    setFilters(filters => [
                                        ...filters,
                                        {
                                            type: "AssignedDate",
                                            operation: {type: "GreaterThanOrEqualTo", date: null},
                                        },
                                    ]);
                                },
                            },
                            {
                                label: "Closed date",
                                onPress: () => {
                                    setFilters(filters => [
                                        ...filters,
                                        {
                                            type: "ClosedDate",
                                            operation: {type: "GreaterThanOrEqualTo", date: null},
                                        },
                                    ]);
                                },
                            },
                            {
                                // NOTE(calebmer): I feel like "Active date" is better copy here than
                                // "Activated date" since it's more inline with "Active" task branding. I don't
                                // know if people will think of themselves as "activating" a task or more like
                                // "setting a task as active".
                                label: "Active date",
                                onPress: () => {
                                    setFilters(filters => [
                                        ...filters,
                                        {
                                            type: "ActivatedDate",
                                            operation: {type: "GreaterThanOrEqualTo", date: null},
                                        },
                                    ]);
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
