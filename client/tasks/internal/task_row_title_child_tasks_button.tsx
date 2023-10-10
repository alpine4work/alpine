import {CaretUp} from "phosphor-react";
import {KeyboardEvent, Ref, forwardRef, useImperativeHandle, useRef} from "react";
import {mergeProps, useHover, usePress} from "react-aria";
import {Box} from "~/client/design/box.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {Tooltip} from "~/client/design/tooltip.js";
import {TaskChildTasksProgressWheel} from "~/client/tasks/internal/task_child_tasks_progress_wheel.js";
import {spacing} from "~/shared/design/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

export type TaskRowTitleChildTasksButtonRef = {
    focus(): void;
};

const TaskRowTitleChildTasksButtonForwardRef = forwardRef(TaskRowTitleChildTasksButton);
export {TaskRowTitleChildTasksButtonForwardRef as TaskRowTitleChildTasksButton};

function TaskRowTitleChildTasksButton(
    {
        childTaskCount,
        closedChildTaskCount,
        areChildTasksExpanded,
        onAreChildTasksExpandedToggle,
        onKeyDown,
    }: {
        childTaskCount: number;
        closedChildTaskCount: number;
        areChildTasksExpanded: boolean;
        onAreChildTasksExpandedToggle: () => void;
        onKeyDown: (event: KeyboardEvent) => void;
    },
    ref: Ref<TaskRowTitleChildTasksButtonRef>,
) {
    const buttonRef = useRef<HTMLDivElement>(null);
    const {hoverProps, isHovered} = useHover({});
    const {pressProps, isPressed} = usePress({onPress: onAreChildTasksExpandedToggle});

    useImperativeHandle(
        ref,
        () => ({
            focus: () => assertExists(buttonRef.current).focus(),
        }),
        [],
    );

    return (
        <Tooltip content={areChildTasksExpanded ? "Collapse subtasks" : "Expand subtasks"}>
            <FocusRing offset="0">
                <Box
                    {...mergeProps(hoverProps, pressProps, {onKeyDown})}
                    ref={buttonRef}
                    // Focusable by keyboard navigation.
                    tabIndex={-1}
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
            </FocusRing>
        </Tooltip>
    );
}
