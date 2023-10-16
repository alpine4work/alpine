import {Plus, SortAscending} from "phosphor-react";
import {Ref, forwardRef, useImperativeHandle, useRef} from "react";
import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {IconButton} from "~/client/design/icon_button.js";
import {MenuButton} from "~/client/design/menu_button.js";
import {
    OverlayTriggerButton,
    OverlayTriggerButtonRef,
} from "~/client/design/overlay_trigger_button.js";
import {TaskQueryFilterEditor} from "~/client/tasks/internal/task_query_filter_editor.js";
import {TaskQuerySortsEditor} from "~/client/tasks/internal/task_query_sorts_editor.js";
import {TaskClientStore} from "~/client/tasks/task_client_store.js";
import {spacing} from "~/shared/design/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {greyElevated2ClassName} from "~/shared/styles/styles.js";
import {TaskQueryFilter} from "~/shared/tasks/task_query_filter.js";
import {TaskQueryFilterReferences} from "~/shared/tasks/task_query_filter_references.js";
import {TaskQuerySort} from "~/shared/tasks/task_query_sort.js";

export type TaskQueryViewCustomizationBarRef = {
    // Throws if no collection filter editor component is mounted. So be careful
    // when calling this function.
    openFirstCollectionsFilterOperationValue(): void;
};

const TaskQueryViewCustomizationBarForwardRef = forwardRef(TaskQueryViewCustomizationBar);
export {TaskQueryViewCustomizationBarForwardRef as TaskQueryViewCustomizationBar};

function TaskQueryViewCustomizationBar(
    {
        store,
        filters,
        filterReferences,
        onFiltersChange,
        shouldCollapseWhenFiltersAreEmpty,
        sorts,
        onSortsChange,
        defaultOrderSentence,
    }: {
        store: TaskClientStore;
        filters: ReadonlyArray<TaskQueryFilter>;
        filterReferences: TaskQueryFilterReferences;
        onFiltersChange: (
            filters: ReadonlyArray<TaskQueryFilter>,
            options?: {mergeFilterReferences?: TaskQueryFilterReferences},
        ) => void;
        shouldCollapseWhenFiltersAreEmpty: boolean;
        sorts: ReadonlyArray<TaskQuerySort>;
        onSortsChange: (sorts: ReadonlyArray<TaskQuerySort>) => void;
        defaultOrderSentence: string;
    },
    ref: Ref<TaskQueryViewCustomizationBarRef>,
) {
    const addFilter = (filter: TaskQueryFilter) => {
        onFiltersChange([...filters, filter]);
    };

    const shouldCollapse = shouldCollapseWhenFiltersAreEmpty && filters.length === 0;

    const firstCollectionsFilterOperationValueTriggerButtonRef =
        useRef<OverlayTriggerButtonRef>(null);
    let hasUsedFirstCollectionsFilterOperationValueTriggerButtonRef = false;

    useImperativeHandle(
        ref,
        () => ({
            openFirstCollectionsFilterOperationValue: () =>
                assertExists(firstCollectionsFilterOperationValueTriggerButtonRef.current).open(),
        }),
        [],
    );

    return (
        <Box display="flex" alignItems="flex-start">
            {filters.length > 0 && (
                <Box height="6" display="flex" alignItems="center" paddingRight="2">
                    Filter:
                </Box>
            )}
            <Box
                flexGrow={!shouldCollapse ? "1" : undefined}
                display="flex"
                flexWrap="wrap"
                alignItems="center"
                gap="2"
                marginLeft={shouldCollapse ? "-2" : undefined}
            >
                {filters.map((filter, index) => {
                    // The first collections filter should get our ref.
                    let collectionsOperationValueTriggerButtonRef = null;
                    if (
                        filter.type === "Collections" &&
                        !hasUsedFirstCollectionsFilterOperationValueTriggerButtonRef
                    ) {
                        hasUsedFirstCollectionsFilterOperationValueTriggerButtonRef = true;
                        collectionsOperationValueTriggerButtonRef =
                            firstCollectionsFilterOperationValueTriggerButtonRef;
                    }

                    return (
                        <TaskQueryFilterEditor
                            key={index}
                            store={store}
                            filter={filter}
                            filterReferences={filterReferences}
                            onFilterChange={(filter, options) => {
                                const newFilters = [...filters];
                                newFilters[index] = filter;

                                onFiltersChange(newFilters, options);
                            }}
                            onFilterRemove={() => {
                                const newFilters = [...filters];
                                newFilters.splice(index, 1);

                                onFiltersChange(newFilters);
                            }}
                            collectionsOperationValueTriggerButtonRef={
                                collectionsOperationValueTriggerButtonRef
                            }
                        />
                    );
                })}
                <MenuButton
                    actions={[
                        [
                            {
                                label: "Status",
                                onPress: () => {
                                    addFilter({
                                        type: "DisplayStatus",
                                        operation: {
                                            type: "OneOf",
                                            displayStatuses: new Set([]),
                                        },
                                    });
                                },
                            },
                            {
                                label: "Collections",
                                onPress: () => {
                                    addFilter({
                                        type: "Collections",
                                        operation: {
                                            type: "IncludesAllOf",
                                            collectionIds: new Set(),
                                        },
                                    });
                                },
                            },
                            {
                                label: "Priority",
                                onPress: () => {
                                    addFilter({
                                        type: "Priority",
                                        operation: {
                                            type: "OneOf",
                                            priorities: new Set(),
                                        },
                                    });
                                },
                            },
                            {
                                label: "Title",
                                onPress: () => {
                                    addFilter({
                                        type: "Title",
                                        operation: {
                                            type: "Includes",
                                            titleQuery: "",
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
                                            type: "GreaterThan",
                                            date: {
                                                type: "RelativeBeforeToday",
                                                duration: {type: "Weeks", count: 1},
                                            },
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
                                            type: "GreaterThan",
                                            date: {
                                                type: "RelativeBeforeToday",
                                                duration: {type: "Weeks", count: 1},
                                            },
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
                                            type: "GreaterThan",
                                            date: {
                                                type: "RelativeBeforeToday",
                                                duration: {type: "Weeks", count: 1},
                                            },
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
                                            type: "GreaterThan",
                                            date: {
                                                type: "RelativeBeforeToday",
                                                duration: {type: "Weeks", count: 1},
                                            },
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
                        <Button
                            variant={shouldCollapse ? "quiet" : "neutral"}
                            icon={<Plus />}
                            height="6"
                            paddingX="2"
                        >
                            Add filter
                        </Button>
                    )}
                </MenuButton>
            </Box>
            <Box paddingLeft={!shouldCollapse ? "5" : "2"}>
                <Box
                    borderLeft={!shouldCollapse ? "grey-5" : undefined}
                    paddingLeft={!shouldCollapse ? "5" : undefined}
                >
                    <OverlayTriggerButton
                        aria-haspopup={true}
                        overlay={
                            <Box
                                className={greyElevated2ClassName}
                                overflow="hidden"
                                borderRadius="md"
                                backgroundColor="grey-0"
                                boxShadow="elevation-20"
                            >
                                <TaskQuerySortsEditor
                                    sorts={sorts}
                                    onSortsChange={onSortsChange}
                                    defaultOrderSentence={defaultOrderSentence}
                                />
                            </Box>
                        }
                    >
                        <Button icon={<SortAscending />} height="6" paddingX="2">
                            {sorts.length === 0
                                ? "Sort"
                                : sorts.length === 1
                                ? "Sort: 1"
                                : `Sorts: ${sorts.length}`}
                        </Button>
                    </OverlayTriggerButton>
                </Box>
            </Box>
        </Box>
    );
}
