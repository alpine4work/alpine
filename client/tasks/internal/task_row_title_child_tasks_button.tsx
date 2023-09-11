import {CaretUp} from "phosphor-react";
import {mergeProps, useHover, usePress} from "react-aria";
import {Box} from "~/client/design/box.js";
import {Tooltip} from "~/client/design/tooltip.js";
import {Store} from "~/client/helpers/store/store.js";
import {useStore} from "~/client/helpers/store/use_store.js";
import {TaskChildTasksProgressWheel} from "~/client/tasks/internal/task_child_tasks_progress_wheel.js";
import {spacing} from "~/shared/design/spacing.js";

export function TaskRowTitleChildTasksButton({
    childTaskCount,
    closedChildTaskCount,
    areChildTasksExpandedStore,
    onAreChildTasksExpandedToggle,
}: {
    childTaskCount: number;
    closedChildTaskCount: number;
    areChildTasksExpandedStore: Store<boolean | undefined>;
    onAreChildTasksExpandedToggle: () => void;
}) {
    const areChildTasksExpanded = useStore(areChildTasksExpandedStore) ?? false;

    const {hoverProps, isHovered} = useHover({});
    const {pressProps, isPressed} = usePress({onPress: onAreChildTasksExpandedToggle});

    return (
        <Tooltip content={areChildTasksExpanded ? "Collapse subtasks" : "Expand subtasks"}>
            <Box
                // NOTE(calebmer): This is intentionally not focusable because keyboard
                // interactivity in task rows uses keyboard shortcuts other than tabbing. Such
                // as arrow keys.
                //
                // TODO(calebmer): We need a keyboard shortcut for toggling subtasks.
                {...mergeProps(hoverProps, pressProps)}
                display="flex"
                alignItems="center"
                marginLeft="3"
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
                        transform: areChildTasksExpanded ? "rotate(180deg)" : "rotate(0deg)",
                        transition: "transform 200ms ease",
                    }}
                />
            </Box>
        </Tooltip>
    );
}
