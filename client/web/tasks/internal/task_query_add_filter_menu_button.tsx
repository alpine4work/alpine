import {ReactElement, Ref, forwardRef, useMemo} from "react";
import {MenuAction} from "~/client/web/design/menu.js";
import {MenuButton} from "~/client/web/design/menu_button.js";
import {OverlayPlacement} from "~/client/web/design/overlay.js";
import {
    OverlayTriggerButtonRef,
    OverlayTriggerButtonState,
} from "~/client/web/design/overlay_trigger_button.js";
import {useSpaceContext} from "~/client/web/spaces/context/space_context.js";
import {Spacing} from "~/shared/design/core/spacing.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.open_source.js";
import {cast} from "~/shared/helpers/control/cast.open_source.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {TaskQueryFilter} from "~/shared/tasks/task_query_filter.js";

const TaskQueryAddFilterMenuButtonForwardRef = forwardRef(TaskQueryAddFilterMenuButton);
export {TaskQueryAddFilterMenuButtonForwardRef as TaskQueryAddFilterMenuButton};

type FilterMenuAction = MenuAction & {filterType: TaskQueryFilter["type"]};

function TaskQueryAddFilterMenuButton(
    {
        onAddFilter,
        placement,
        offset,
        offsetAlong,
        onStateChange,
        excludeFilters,
        children,
    }: {
        onAddFilter: (filter: TaskQueryFilter) => void;
        placement?: OverlayPlacement;
        offset?: Spacing;
        offsetAlong?: Spacing;
        onStateChange?: (state: OverlayTriggerButtonState) => void;
        /**
         * Filter types to exclude from the menu. Use this when certain filter types don't
         * make sense for the context (e.g., Assignee filter in My Tasks since it's always
         * filtered to the current user).
         */
        excludeFilters?: ReadonlySet<TaskQueryFilter["type"]>;
        children: ReactElement;
    },
    ref: Ref<OverlayTriggerButtonRef>,
) {
    const {currentAccount} = useSpaceContext();

    const actions = useMemo(() => {
        const filterMenuSections = getFilterMenuSections({currentAccount, onAddFilter});
        const filterSection = (section: Array<FilterMenuAction>): Array<MenuAction> | undefined => {
            const sectionItems = excludeFilters
                ? section.filter(action => !excludeFilters.has(action.filterType))
                : section;

            if (sectionItems.length === 0) return undefined;

            return sectionItems;
        };

        return filterMapArray(filterMenuSections, filterSection);
    }, [currentAccount, excludeFilters, onAddFilter]);

    return (
        <MenuButton
            ref={ref}
            placement={placement}
            offset={offset}
            offsetAlong={offsetAlong}
            onStateChange={onStateChange}
            actions={actions}
        >
            {children}
        </MenuButton>
    );
}

function getFilterMenuSections({
    currentAccount,
    onAddFilter,
}: {
    currentAccount: AccountModel | null;
    onAddFilter: (filter: TaskQueryFilter) => void;
}): Array<Array<FilterMenuAction>> {
    return [
        // First menu section (status, collections, priority, project, title)
        [
            {
                filterType: "DisplayStatus",
                label: "Status",
                onPress: () => {
                    onAddFilter({
                        type: "DisplayStatus",
                        operation: {
                            type: "OneOf",
                            displayStatuses: new Set([]),
                        },
                    });
                },
            },
            {
                filterType: "Collections",
                label: "Collections",
                onPress: () => {
                    onAddFilter({
                        type: "Collections",
                        operation: {
                            type: "IncludesAllOf",
                            collectionIds: new Set(),
                        },
                    });
                },
            },
            {
                filterType: "Priority",
                label: "Priority",
                onPress: () => {
                    onAddFilter({
                        type: "Priority",
                        operation: {
                            type: "OneOf",
                            priorities: new Set(),
                        },
                    });
                },
            },
            {
                filterType: "Title",
                label: "Title",
                onPress: () => {
                    onAddFilter({
                        type: "Title",
                        operation: {
                            type: "Includes",
                            titleQuery: "",
                        },
                    });
                },
            },
            {
                filterType: "Layout",
                label: "Project",
                onPress: () => {
                    onAddFilter({
                        type: "Layout",
                        operation: {
                            type: "OneOf",
                            layouts: ["Project"],
                        },
                    });
                },
            },
        ],
        // Second menu section (assignee, creator, assigner)
        [
            {
                filterType: "Assignee",
                label: "Assignee",
                onPress: () => {
                    onAddFilter({
                        type: "Assignee",
                        operation: {
                            type: "OneOf",
                            accounts: currentAccount ? [{type: "CurrentAccount"}] : [],
                        },
                    });
                },
            },
            // Accounts without space access aren't allowed to filter by creator or assigner.
            ...(currentAccount
                ? cast<Array<FilterMenuAction>>([
                      {
                          filterType: "Creator",
                          label: "Creator",
                          onPress: () => {
                              onAddFilter({
                                  type: "Creator",
                                  operation: {
                                      type: "OneOf",
                                      accounts: [{type: "CurrentAccount"}],
                                  },
                              });
                          },
                      },
                      {
                          filterType: "Assigner",
                          label: "Assigner",
                          onPress: () => {
                              onAddFilter({
                                  type: "Assigner",
                                  operation: {
                                      type: "OneOf",
                                      accounts: [{type: "CurrentAccount"}],
                                  },
                              });
                          },
                      },
                  ])
                : []),
        ],
        // Third menu section (due date, created date, assigned date, closed date, active
        // date)
        [
            {
                filterType: "DueDate",
                label: "Due date",
                onPress: () => {
                    onAddFilter({
                        type: "DueDate",
                        operation: {type: "Overdue"},
                    });
                },
            },
            {
                filterType: "CreatedDate",
                label: "Created date",
                onPress: () => {
                    onAddFilter({
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
                filterType: "AssignedDate",
                label: "Assigned date",
                onPress: () => {
                    onAddFilter({
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
                filterType: "ClosedDate",
                label: "Closed date",
                onPress: () => {
                    onAddFilter({
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
                // NOTE(calebmer): I feel like "Active date" is better copy here than "Activated
                // date" since it's more inline with "Active" task branding. I don't know if people
                // will think of themselves as "activating" a task or more like "setting a task as
                // active".
                filterType: "ActivatedDate",
                label: "Active date",
                onPress: () => {
                    onAddFilter({
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
    ];
}
