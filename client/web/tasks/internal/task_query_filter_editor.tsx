import {X} from "phosphor-react";
import {ReactNode, Ref} from "react";
import {Box} from "~/client/web/design/box.js";
import {IconButton} from "~/client/web/design/icon_button.js";
import {OverlayTriggerButtonRef} from "~/client/web/design/overlay_trigger_button.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {taskQueryFilterEditorDesktopHeight} from "~/client/web/styles/tasks_shared_styles.js";
import {TaskClientStore} from "~/client/web/tasks/core/task_client_store.js";
import {TaskQueryCollectionsFilterOperationEditor} from "~/client/web/tasks/internal/task_query_collections_filter_operation_editor.js";
import {TaskQueryDisplayStatusFilterOperationEditor} from "~/client/web/tasks/internal/task_query_display_status_filter_operation_editor.js";
import {TaskQueryFilterAccountOperationEditor} from "~/client/web/tasks/internal/task_query_filter_account_operation_editor.js";
import {
    TaskQueryFilterDateOperationEditor,
    TaskQueryFilterDateOperationValueEditor,
    taskQueryFilterDateOperationGreaterThanOperatorLabel,
    taskQueryFilterDateOperationLessThanOperatorLabel,
} from "~/client/web/tasks/internal/task_query_filter_date_operation_editor.js";
import {TaskQueryFilterOperatorEditor} from "~/client/web/tasks/internal/task_query_filter_operator_editor.js";
import {TaskQueryPriorityFilterOperationEditor} from "~/client/web/tasks/internal/task_query_priority_filter_operation_editor.js";
import {TaskQueryReferencesForUrlGrantFilterEditor} from "~/client/web/tasks/internal/task_query_references_for_url_grant_filter_editor.js";
import {TaskQueryTitleFilterOperationEditor} from "~/client/web/tasks/internal/task_query_title_filter_operation_editor.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {TaskQueryFilter} from "~/shared/tasks/task_query_filter.js";
import {TaskQueryFilterReferences} from "~/shared/tasks/task_query_filter_references.js";

export function TaskQueryFilterEditor({
    store,
    queryReferencesForUrlGrant,
    filter,
    filterReferences,
    onFilterChange,
    onFilterRemove,
    collectionsOperationValueTriggerButtonRef = null,
}: {
    store: TaskClientStore;
    queryReferencesForUrlGrant: TaskQueryReferencesForUrlGrantFilterEditor | null;
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
            return (
                <TaskQueryFilterEditorBase
                    name="Collections"
                    operation={
                        <TaskQueryCollectionsFilterOperationEditor
                            store={store}
                            queryReferencesForUrlGrant={queryReferencesForUrlGrant}
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
            return (
                <TaskQueryFilterEditorBase
                    name="Title"
                    operation={
                        <TaskQueryTitleFilterOperationEditor
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
                            queryReferencesForUrlGrant={queryReferencesForUrlGrant}
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
                    name="Creator"
                    operation={
                        <TaskQueryFilterAccountOperationEditor
                            queryReferencesForUrlGrant={queryReferencesForUrlGrant}
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
                    name="Assigner"
                    operation={
                        <TaskQueryFilterAccountOperationEditor
                            queryReferencesForUrlGrant={queryReferencesForUrlGrant}
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
    const platform = usePlatform();

    return (
        <Box
            overflow="hidden"
            width={platform === "mobile" ? "full" : undefined}
            height={platform === "mobile" ? "9" : taskQueryFilterEditorDesktopHeight}
            display="flex"
            alignItems="center"
            borderRadius="1"
            border="grey-10"
        >
            <Box
                paddingLeft={platform === "mobile" ? "3" : "2"}
                paddingRight="1"
                style={{whiteSpace: "nowrap"}}
            >
                {name}
            </Box>
            {operation}
            {platform === "mobile" && <Box flexGrow="1" />}
            <Box
                flexShrink="0"
                paddingLeft={platform === "mobile" ? "1.5" : "1"}
                style={{
                    // Subtract 1px from our right padding since that's the border width. That
                    // will give us good margin on all sides of the button.
                    paddingRight: `calc(${spacing[platform === "mobile" ? "1.5" : "0.5"]} - 1px)`,
                }}
            >
                <IconButton
                    size={platform === "mobile" ? "md" : "xs"}
                    description="Remove"
                    withoutTooltip
                    borderRadius="0.5"
                    onPress={onFilterRemove}
                >
                    <X />
                </IconButton>
            </Box>
        </Box>
    );
}
