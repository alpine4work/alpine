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
import {TaskQuerySort} from "~/shared/tasks/task_query_sort.js";

const TaskQueryAddSortMenuButtonForwardRef = forwardRef(TaskQueryAddSortMenuButton);
export {TaskQueryAddSortMenuButtonForwardRef as TaskQueryAddSortMenuButton};

function TaskQueryAddSortMenuButton(
    {
        onAddSort,
        placement,
        offset,
        offsetAlong,
        onStateChange,
        children,
    }: {
        onAddSort: (sort: TaskQuerySort) => void;
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
                            onAddSort({
                                type: "DisplayStatus",
                                direction: "Ascending",
                            });
                        },
                    },
                    {
                        label: "Priority",
                        onPress: () => {
                            onAddSort({
                                type: "Priority",
                                direction: "Descending",
                            });
                        },
                    },
                ],
                [
                    {
                        label: "Assignee",
                        onPress: () => {
                            onAddSort({
                                type: "Assignee",
                                missing: "Last",
                            });
                        },
                    },
                    ...(currentAccount
                        ? cast<Array<MenuAction>>([
                              {
                                  label: "Creator",
                                  onPress: () => {
                                      onAddSort({type: "Creator"});
                                  },
                              },
                              {
                                  label: "Assigner",
                                  onPress: () => {
                                      onAddSort({
                                          type: "Assigner",
                                          missing: "Last",
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
                            onAddSort({
                                type: "DueDate",
                                direction: "Ascending",
                            });
                        },
                    },
                    {
                        label: "Created date",
                        onPress: () => {
                            onAddSort({
                                type: "CreatedTime",
                                direction: "Ascending",
                            });
                        },
                    },
                    {
                        label: "Assigned date",
                        onPress: () => {
                            onAddSort({
                                type: "AssignedTime",
                                direction: "Ascending",
                            });
                        },
                    },
                    {
                        label: "Closed date",
                        onPress: () => {
                            onAddSort({
                                type: "ClosedTime",
                                direction: "Ascending",
                            });
                        },
                    },
                    {
                        label: "Active date",
                        onPress: () => {
                            onAddSort({
                                type: "ActivatedTime",
                                direction: "Ascending",
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
