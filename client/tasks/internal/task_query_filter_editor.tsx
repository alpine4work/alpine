import {X} from "phosphor-react";
import {ReactNode, Ref} from "react";
import {Box} from "~/client/design/box.js";
import {IconButton} from "~/client/design/icon_button.js";
import {OverlayTriggerButtonRef} from "~/client/design/overlay_trigger_button.js";
import {TaskQueryCollectionsFilterOperationEditor} from "~/client/tasks/internal/task_query_collections_filter_operation_editor.js";
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
import {TaskQueryTitleFilterOperationEditor} from "~/client/tasks/internal/task_query_title_filter_operation_editor.js";
import {TaskClientStore} from "~/client/tasks/task_client_store.js";
import {spacing} from "~/shared/design/spacing.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {TaskQueryFilter} from "~/shared/tasks/task_query_filter.js";
import {TaskQueryFilterReferences} from "~/shared/tasks/task_query_filter_references.js";

export const desktopTaskQueryFilterEditorHeight = "6";

export function TaskQueryFilterEditor({
    withMobileLayout,
    store,
    filter,
    filterReferences,
    onFilterChange,
    onFilterRemove,
    collectionsOperationValueTriggerButtonRef = null,
}: {
    withMobileLayout: boolean;
    store: TaskClientStore;
    filter: TaskQueryFilter;
    filterReferences: TaskQueryFilterReferences;
    onFilterChange: (
        filter: TaskQueryFilter,
        options?: {mergeFilterReferences?: TaskQueryFilterReferences},
    ) => void;
    onFilterRemove: () => void;
    collectionsOperationValueTriggerButtonRef?: Ref<OverlayTriggerButtonRef> | null;
}) {
    switch (filter.type) {
        case "DisplayStatus": {
            return (
                <TaskQueryFilterEditorBase
                    withMobileLayout={withMobileLayout}
                    name="Status"
                    operation={
                        <TaskQueryDisplayStatusFilterOperationEditor
                            withMobileLayout={withMobileLayout}
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
                    withMobileLayout={withMobileLayout}
                    name="Collections"
                    operation={
                        <TaskQueryCollectionsFilterOperationEditor
                            withMobileLayout={withMobileLayout}
                            store={store}
                            filter={filter}
                            filterReferences={filterReferences}
                            onFilterChange={onFilterChange}
                            valueTriggerButtonRef={collectionsOperationValueTriggerButtonRef}
                        />
                    }
                    onFilterRemove={onFilterRemove}
                />
            );
        }
        case "Priority": {
            return (
                <TaskQueryFilterEditorBase
                    withMobileLayout={withMobileLayout}
                    name="Priority"
                    operation={
                        <TaskQueryPriorityFilterOperationEditor
                            withMobileLayout={withMobileLayout}
                            filter={filter}
                            onFilterChange={onFilterChange}
                        />
                    }
                    onFilterRemove={onFilterRemove}
                />
            );
        }
        case "Title": {
            return (
                <TaskQueryFilterEditorBase
                    withMobileLayout={withMobileLayout}
                    name="Title"
                    operation={
                        <TaskQueryTitleFilterOperationEditor
                            withMobileLayout={withMobileLayout}
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
                    withMobileLayout={withMobileLayout}
                    name="Assignee"
                    operation={
                        <TaskQueryFilterAccountOperationEditor
                            withMobileLayout={withMobileLayout}
                            inputLabel="Assignee"
                            filterReferences={filterReferences}
                            operation={filter.operation}
                            onOperationChange={(operation, options) =>
                                onFilterChange({...filter, operation}, options)
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
                    withMobileLayout={withMobileLayout}
                    name="Creator"
                    operation={
                        <TaskQueryFilterAccountOperationEditor
                            withMobileLayout={withMobileLayout}
                            inputLabel="Creator"
                            // Tasks always have a creator so hide the `MissingAccount` filter option.
                            shouldHideMissingAccountItem={true}
                            filterReferences={filterReferences}
                            operation={filter.operation}
                            onOperationChange={(operation, options) =>
                                onFilterChange({...filter, operation}, options)
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
                    withMobileLayout={withMobileLayout}
                    name="Assigner"
                    operation={
                        <TaskQueryFilterAccountOperationEditor
                            withMobileLayout={withMobileLayout}
                            inputLabel="Assigner"
                            filterReferences={filterReferences}
                            operation={filter.operation}
                            onOperationChange={(operation, options) =>
                                onFilterChange({...filter, operation}, options)
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
                    withMobileLayout={withMobileLayout}
                    name="Due date"
                    operation={
                        <>
                            <TaskQueryFilterOperatorEditor
                                withMobileLayout={withMobileLayout}
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
                                        withMobileLayout={withMobileLayout}
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
                    withMobileLayout={withMobileLayout}
                    name="Created date"
                    operation={
                        <TaskQueryFilterDateOperationEditor
                            withMobileLayout={withMobileLayout}
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
                    withMobileLayout={withMobileLayout}
                    name="Assigned date"
                    operation={
                        <TaskQueryFilterDateOperationEditor
                            withMobileLayout={withMobileLayout}
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
                    withMobileLayout={withMobileLayout}
                    name="Closed date"
                    operation={
                        <TaskQueryFilterDateOperationEditor
                            withMobileLayout={withMobileLayout}
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
                    withMobileLayout={withMobileLayout}
                    name="Active date"
                    operation={
                        <TaskQueryFilterDateOperationEditor
                            withMobileLayout={withMobileLayout}
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
    withMobileLayout,
    name,
    operation,
    onFilterRemove,
}: {
    withMobileLayout: boolean;
    name: string;
    operation: ReactNode;
    onFilterRemove: () => void;
}) {
    return (
        <Box
            overflow="hidden"
            width={withMobileLayout ? "full" : undefined}
            height={withMobileLayout ? "9" : desktopTaskQueryFilterEditorHeight}
            display="flex"
            alignItems="center"
            borderRadius="base"
            border="grey-10"
        >
            <Box
                paddingLeft={withMobileLayout ? "3" : "2"}
                paddingRight="1"
                style={{whiteSpace: "nowrap"}}
            >
                {name}
            </Box>
            {operation}
            {withMobileLayout && <Box flexGrow="1" />}
            <Box
                flexShrink="0"
                paddingLeft={withMobileLayout ? "1.5" : "1"}
                style={{
                    // Subtract 1px from our right padding since that's the border width. That
                    // will give us good margin on all sides of the button.
                    paddingRight: `calc(${spacing[withMobileLayout ? "1.5" : "0.5"]} - 1px)`,
                }}
            >
                <IconButton
                    size={withMobileLayout ? "md" : "xs"}
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
