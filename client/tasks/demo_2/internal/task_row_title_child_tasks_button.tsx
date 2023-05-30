import {CaretUp} from "phosphor-react";
import {mergeProps, useHover, usePress} from "react-aria";
import {Box} from "~/client/design/box";
import {Tooltip} from "~/client/design/tooltip";
import {TaskChildTasksProgressWheel} from "~/client/tasks/demo_2/internal/task_child_tasks_progress_wheel";
import {spacing} from "~/shared/design/spacing";

export function TaskRowTitleChildTasksButton({
    childTaskCount,
    closedChildTaskCount,
    areChildTasksCollapsed,
    onAreChildTasksCollapsedToggle,
}: {
    childTaskCount: number;
    closedChildTaskCount: number;
    areChildTasksCollapsed: boolean;
    onAreChildTasksCollapsedToggle: () => void;
}) {
    const {hoverProps, isHovered} = useHover({});
    const {pressProps, isPressed} = usePress({onPress: onAreChildTasksCollapsedToggle});

    return (
        <Tooltip content={areChildTasksCollapsed ? "Expand subtasks" : "Collapse subtasks"}>
            <Box
                // NOTE(calebmer): This is intentionally not focusable because keyboard
                // interactivity in task rows uses keyboard shortcuts other than tabbing. Such
                // as arrow keys.
                //
                // TODO(calebmer): We need a keyboard shortcut for toggling subtasks.
                {...mergeProps(hoverProps, pressProps)}
                display="flex"
                alignItems="center"
                paddingLeft="1"
                paddingRight="0.5"
                paddingY="0.5"
                gap="1"
                borderRadius="base"
                backgroundColor={isPressed ? "grey-10" : isHovered ? "grey-5" : undefined}
            >
                <TaskChildTasksProgressWheel
                    childTaskCount={childTaskCount}
                    closedChildTaskCount={closedChildTaskCount}
                    isHovered={isHovered}
                    isPressed={isPressed}
                />
                <Box color="grey-70">
                    {closedChildTaskCount}/{childTaskCount}
                </Box>
                <CaretUp
                    size={spacing["3"]}
                    style={{
                        transform: areChildTasksCollapsed ? "rotate(0deg)" : "rotate(180deg)",
                        transition: "transform 200ms ease",
                    }}
                />
            </Box>
        </Tooltip>
    );
}
