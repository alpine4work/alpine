import {X} from "phosphor-react";
import {ReactNode} from "react";
import {Box} from "~/client/design/box";
import {IconButton} from "~/client/design/icon_button";
import {TaskQueryCollectionsFilterOperationEditor} from "~/client/tasks/demo_2/internal/task_query_collections_filter_operation_editor";
import {TaskQueryFilterAccountOperationEditor} from "~/client/tasks/demo_2/internal/task_query_filter_account_operation_editor";
import {
    TaskQueryFilterDateOperationEditor,
    TaskQueryFilterDateOperationValueEditor,
    taskQueryFilterDateOperationGreaterThanOperatorLabel,
    taskQueryFilterDateOperationLessThanOperatorLabel,
} from "~/client/tasks/demo_2/internal/task_query_filter_date_operation_editor";
import {TaskQueryFilterOperatorEditor} from "~/client/tasks/demo_2/internal/task_query_filter_operator_editor";
import {LocalTasksState} from "~/client/tasks/demo_2/local_tasks_state";
import {TaskQueryFilter, TaskQueryStatusFilter} from "~/client/tasks/demo_2/task_query_filter";
import {spacing} from "~/shared/design/spacing";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {TaskQueryFilterReferences} from "~/shared/tasks/task_query_filter_references";

export function TaskQueryFilterEditor({
    state,
    filter,
    filterReferences,
    onFilterChange,
    onFilterRemove,
}: {
    state: LocalTasksState;
    filter: TaskQueryFilter;
    filterReferences: TaskQueryFilterReferences;
    onFilterChange: (
        filter: TaskQueryFilter,
        mergeFilterReferences?: TaskQueryFilterReferences,
    ) => void;
    onFilterRemove: () => void;
}) {
    switch (filter.type) {
        case "Status": {
            return (
                <TaskQueryFilterEditorBase
                    name="Status"
                    operation={
                        <TaskQueryStatusFilterOperationEditor
                            filter={filter}
                            onFilterChange={onFilterChange}
                        />
                    }
                    onFilterRemove={onFilterRemove}
                />
            );
        }
        case "Collections": {
            return (
                <TaskQueryFilterEditorBase
                    name="Collections"
                    operation={
                        <TaskQueryCollectionsFilterOperationEditor
                            state={state}
                            filter={filter}
                            onFilterChange={onFilterChange}
                        />
                    }
                    onFilterRemove={onFilterRemove}
                />
            );
        }
        case "Assignee": {
            return (
                <TaskQueryFilterEditorBase
                    name="Assignee"
                    operation={
                        <TaskQueryFilterAccountOperationEditor
                            inputLabel="Assignee"
                            filterReferences={filterReferences}
                            operation={filter.operation}
                            onOperationChange={(operation, mergeFilterReferences) =>
                                onFilterChange({...filter, operation}, mergeFilterReferences)
                            }
                        />
                    }
                    onFilterRemove={onFilterRemove}
                />
            );
        }
        case "Creator": {
            return (
                <TaskQueryFilterEditorBase
                    name="Creator"
                    operation={
                        <TaskQueryFilterAccountOperationEditor
                            inputLabel="Creator"
                            // Tasks always have a creator so hide the `NoAccount` filter option.
                            shouldHideNoAccountItem={true}
                            filterReferences={filterReferences}
                            operation={filter.operation}
                            onOperationChange={(operation, mergeFilterReferences) =>
                                onFilterChange({...filter, operation}, mergeFilterReferences)
                            }
                        />
                    }
                    onFilterRemove={onFilterRemove}
                />
            );
        }
        case "Assigner": {
            return (
                <TaskQueryFilterEditorBase
                    name="Assigner"
                    operation={
                        <TaskQueryFilterAccountOperationEditor
                            inputLabel="Assigner"
                            filterReferences={filterReferences}
                            operation={filter.operation}
                            onOperationChange={(operation, mergeFilterReferences) =>
                                onFilterChange({...filter, operation}, mergeFilterReferences)
                            }
                        />
                    }
                    onFilterRemove={onFilterRemove}
                />
            );
        }
        case "DueDate": {
            const overdueOperatorLabel = "is overdue";

            return (
                <TaskQueryFilterEditorBase
                    name="Due date"
                    operation={
                        <>
                            <TaskQueryFilterOperatorEditor
                                operatorLabel={
                                    filter.operation.type === "Overdue"
                                        ? overdueOperatorLabel
                                        : filter.operation.type === "LessThan"
                                        ? taskQueryFilterDateOperationLessThanOperatorLabel
                                        : taskQueryFilterDateOperationGreaterThanOperatorLabel
                                }
                                allOperators={[
                                    {
                                        label: overdueOperatorLabel,
                                        isSelected: filter.operation.type === "Overdue",
                                        onPress: () => {
                                            onFilterChange({
                                                ...filter,
                                                operation: {type: "Overdue"},
                                            });
                                        },
                                    },
                                    {
                                        label: taskQueryFilterDateOperationLessThanOperatorLabel,
                                        isSelected: filter.operation.type === "LessThan",
                                        onPress: () => {
                                            onFilterChange({
                                                ...filter,
                                                operation: {
                                                    type: "LessThan",
                                                    date:
                                                        filter.operation.type !== "Overdue"
                                                            ? filter.operation.date
                                                            : {
                                                                  type: "RelativeAfterToday",
                                                                  duration: {
                                                                      type: "Weeks",
                                                                      count: 1,
                                                                  },
                                                              },
                                                },
                                            });
                                        },
                                    },
                                    {
                                        label: taskQueryFilterDateOperationGreaterThanOperatorLabel,
                                        isSelected: filter.operation.type === "GreaterThan",
                                        onPress: () => {
                                            onFilterChange({
                                                ...filter,
                                                operation: {
                                                    type: "GreaterThan",
                                                    date:
                                                        filter.operation.type !== "Overdue"
                                                            ? filter.operation.date
                                                            : {
                                                                  type: "RelativeBeforeToday",
                                                                  duration: {
                                                                      type: "Weeks",
                                                                      count: 1,
                                                                  },
                                                              },
                                                },
                                            });
                                        },
                                    },
                                ]}
                            />
                            {filter.operation.type !== "Overdue" && (
                                <TaskQueryFilterDateOperationValueEditor
                                    operation={filter.operation}
                                    onOperationChange={operation =>
                                        onFilterChange({...filter, operation})
                                    }
                                />
                            )}
                        </>
                    }
                    onFilterRemove={onFilterRemove}
                />
            );
        }
        case "CreatedDate": {
            return (
                <TaskQueryFilterEditorBase
                    name="Created date"
                    operation={
                        <TaskQueryFilterDateOperationEditor
                            operation={filter.operation}
                            onOperationChange={operation => onFilterChange({...filter, operation})}
                        />
                    }
                    onFilterRemove={onFilterRemove}
                />
            );
        }
        case "AssignedDate": {
            return (
                <TaskQueryFilterEditorBase
                    name="Assigned date"
                    operation={
                        <TaskQueryFilterDateOperationEditor
                            operation={filter.operation}
                            onOperationChange={operation => onFilterChange({...filter, operation})}
                        />
                    }
                    onFilterRemove={onFilterRemove}
                />
            );
        }
        case "ClosedDate": {
            return (
                <TaskQueryFilterEditorBase
                    name="Closed date"
                    operation={
                        <TaskQueryFilterDateOperationEditor
                            operation={filter.operation}
                            onOperationChange={operation => onFilterChange({...filter, operation})}
                        />
                    }
                    onFilterRemove={onFilterRemove}
                />
            );
        }
        case "ActivatedDate": {
            return (
                <TaskQueryFilterEditorBase
                    name="Active date"
                    operation={
                        <TaskQueryFilterDateOperationEditor
                            operation={filter.operation}
                            onOperationChange={operation => onFilterChange({...filter, operation})}
                        />
                    }
                    onFilterRemove={onFilterRemove}
                />
            );
        }
        default:
            throw exhaustive(filter);
    }
}

function TaskQueryFilterEditorBase({
    name,
    operation,
    onFilterRemove,
}: {
    name: string;
    operation: ReactNode;
    onFilterRemove: () => void;
}) {
    return (
        <Box height="6" display="flex" alignItems="center" borderRadius="base" border="grey-10">
            <Box paddingLeft="2" paddingRight="1">
                {name}
            </Box>
            {operation}
            <Box
                paddingLeft="1.5"
                style={{
                    // Subtract 1px from our right padding since that's the border width. That
                    // will give us good margin on all sides of the button.
                    paddingRight: `calc(${spacing["1"]} - 1px)`,
                }}
            >
                <IconButton
                    size="xs"
                    description="Remove"
                    withoutTooltip
                    borderRadius="sm"
                    onPress={onFilterRemove}
                >
                    <X />
                </IconButton>
            </Box>
        </Box>
    );
}

function TaskQueryStatusFilterOperationEditor({
    filter,
    onFilterChange,
}: {
    filter: TaskQueryStatusFilter;
    onFilterChange: (filter: TaskQueryStatusFilter) => void;
}) {
    return (
        <>
            <TaskQueryFilterOperatorEditor
                operatorLabel={filter.operation.type === "OneOf" ? "is" : "is not"}
                allOperators={[
                    {
                        label: "is",
                        isSelected: filter.operation.type === "OneOf",
                        onPress: () => {
                            onFilterChange({
                                type: "Status",
                                operation: {type: "OneOf", statuses: filter.operation.statuses},
                            });
                        },
                    },
                    {
                        label: "is not",
                        isSelected: filter.operation.type === "NoneOf",
                        onPress: () => {
                            onFilterChange({
                                type: "Status",
                                operation: {type: "NoneOf", statuses: filter.operation.statuses},
                            });
                        },
                    },
                ]}
            />
            open
        </>
    );
}
