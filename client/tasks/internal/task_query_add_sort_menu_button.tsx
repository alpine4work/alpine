import {ReactElement, Ref, forwardRef} from "react";
import {MenuButton} from "~/client/design/menu_button.js";
import {OverlayPlacement} from "~/client/design/overlay.js";
import {
    OverlayTriggerButtonRef,
    OverlayTriggerButtonState,
} from "~/client/design/overlay_trigger_button.js";
import {Spacing} from "~/shared/design/spacing.js";
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
