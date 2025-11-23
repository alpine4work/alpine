import {ReactElement, Ref, forwardRef} from "react";
import {MenuAction} from "~/client/web/design/menu.js";
import {MenuButton} from "~/client/web/design/menu_button.js";
import {OverlayPlacement} from "~/client/web/design/overlay.js";
import {
    OverlayTriggerButtonRef,
    OverlayTriggerButtonState,
} from "~/client/web/design/overlay_trigger_button.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {Spacing} from "~/shared/design/core/spacing.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {TaskQueryFilter} from "~/shared/tasks/task_query_filter.js";

const TaskQueryAddFilterMenuButtonForwardRef = forwardRef(TaskQueryAddFilterMenuButton);
export {TaskQueryAddFilterMenuButtonForwardRef as TaskQueryAddFilterMenuButton};

function TaskQueryAddFilterMenuButton(
    {
        onAddFilter,
        placement,
        offset,
        offsetAlong,
        onStateChange,
        children,
    }: {
        onAddFilter: (filter: TaskQueryFilter) => void;
        placement?: OverlayPlacement;
        offset?: Spacing;
        offsetAlong?: Spacing;
        onStateChange?: (state: OverlayTriggerButtonState) => void;
        children: ReactElement;
    },
    ref: Ref<OverlayTriggerButtonRef>,
) {
    const {currentAccount} = useSpaceContext();

    return (
        <MenuButton
            ref={ref}
            placement={placement}
            offset={offset}
            offsetAlong={offsetAlong}
            onStateChange={onStateChange}
            actions={[
                [
                    {
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
                ],
                [
                    {
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
                    // Accounts without space access aren't allowed to filter by creator or
                    // assigner.
                    ...(currentAccount
                        ? cast<Array<MenuAction>>([
                              {
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
                [
                    {
                        label: "Due date",
                        onPress: () => {
                            onAddFilter({
                                type: "DueDate",
                                operation: {type: "Overdue"},
                            });
                        },
                    },
                    {
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
                        // NOTE(calebmer): I feel like "Active date" is better copy here than
                        // "Activated date" since it's more inline with "Active" task branding. I don't
                        // know if people will think of themselves as "activating" a task or more like
                        // "setting a task as active".
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
            ]}
        >
            {children}
        </MenuButton>
    );
}
