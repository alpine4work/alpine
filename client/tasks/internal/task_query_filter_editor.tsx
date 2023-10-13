import {X} from "phosphor-react";
import {ReactNode} from "react";
import {Box} from "~/client/design/box.js";
import {IconButton} from "~/client/design/icon_button.js";
// NOCOMMIT: import {TaskQueryCollectionsFilterOperationEditor} from "~/client/tasks/internal/task_query_collections_filter_operation_editor.js";
import {TaskQueryDisplayStatusFilterOperationEditor} from "~/client/tasks/internal/task_query_display_status_filter_operation_editor.js";
import {TaskQueryFilterAccountOperationEditor} from "~/client/tasks/internal/task_query_filter_account_operation_editor.js";
import {
    TaskQueryFilterDateOperationEditor,
    TaskQueryFilterDateOperationValueEditor,
    taskQueryFilterDateOperationGreaterThanOperatorLabel,
    taskQueryFilterDateOperationLessThanOperatorLabel,
} from "~/client/tasks/internal/task_query_filter_date_operation_editor.js";
import {TaskQueryFilterOperatorEditor} from "~/client/tasks/internal/task_query_filter_operator_editor.js";
import {TaskQueryPriorityFilterOperationEditor} from "~/client/tasks/internal/task_query_priority_filter_operation_editor.js";
import {spacing} from "~/shared/design/spacing.js";
import {UnimplementedError} from "~/shared/error/error.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {TaskQueryFilter} from "~/shared/tasks/task_query_filter.js";
import {TaskQueryFilterReferences} from "~/shared/tasks/task_query_filter_references.js";

export function TaskQueryFilterEditor({
    filter,
    filterReferences,
    onFilterChange,
    onFilterRemove,
}: {
    filter: TaskQueryFilter;
    filterReferences: TaskQueryFilterReferences;
    onFilterChange: (
        filter: TaskQueryFilter,
        mergeFilterReferences?: TaskQueryFilterReferences,
    ) => void;
    onFilterRemove: () => void;
}) {
    switch (filter.type) {
        case "DisplayStatus": {
            return (
                <TaskQueryFilterEditorBase
                    name="Status"
                    operation={
                        <TaskQueryDisplayStatusFilterOperationEditor
                            filter={filter}
                            onFilterChange={onFilterChange}
                        />
                    }
                    onFilterRemove={onFilterRemove}
                />
            );
        }
        case "Collections": {
            throw new UnimplementedError("NOCOMMIT");

            return (
                <TaskQueryFilterEditorBase
                    name="Collections"
                    operation={
                        <TaskQueryCollectionsFilterOperationEditor
                            filter={filter}
                            onFilterChange={onFilterChange}
                        />
                    }
                    onFilterRemove={onFilterRemove}
                />
            );
        }
        case "Priority": {
            return (
                <TaskQueryFilterEditorBase
                    name="Priority"
                    operation={
                        <TaskQueryPriorityFilterOperationEditor
                            filter={filter}
                            onFilterChange={onFilterChange}
                        />
                    }
                    onFilterRemove={onFilterRemove}
                />
            );
        }
        case "Title": {
            // NOCOMMIT
            throw new UnimplementedError("TODO");
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
                            // Tasks always have a creator so hide the `MissingAccount` filter option.
                            shouldHideMissingAccountItem={true}
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
            const isEmptyOperatorLabel = "is empty";

            return (
                <TaskQueryFilterEditorBase
                    name="Due date"
                    operation={
                        <>
                            <TaskQueryFilterOperatorEditor
                                operatorLabel={
                                    filter.operation.type === "Overdue"
                                        ? overdueOperatorLabel
                                        : filter.operation.type === "IsEmpty"
                                        ? isEmptyOperatorLabel
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
                                                        filter.operation.type !== "Overdue" &&
                                                        filter.operation.type !== "IsEmpty"
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
                                                        filter.operation.type !== "Overdue" &&
                                                        filter.operation.type !== "IsEmpty"
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
                                    {
                                        label: isEmptyOperatorLabel,
                                        isSelected: filter.operation.type === "IsEmpty",
                                        onPress: () => {
                                            onFilterChange({
                                                ...filter,
                                                operation: {type: "IsEmpty"},
                                            });
                                        },
                                    },
                                ]}
                            />
                            {filter.operation.type !== "Overdue" &&
                                filter.operation.type !== "IsEmpty" && (
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
