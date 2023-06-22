import {Ref, forwardRef, useImperativeHandle, useRef, useState} from "react";
import {Box} from "~/client/design/box";
import {useHoverWithOverlaySupport} from "~/client/helpers/use_hover_with_overlay_support";
import {
    TaskPriorityInput,
    TaskPriorityInputRef,
} from "~/client/tasks/demo_2/internal/task_priority_input";
import {
    taskRowViewColumnPaddingX,
    taskRowViewColumnWidth,
    taskRowViewMinHeight,
} from "~/client/tasks/demo_2/internal/task_row_shared_styles";
import {TaskPriority} from "~/client/tasks/demo_2/local_tasks_state";
import {useOutOfBoundsClickSelection} from "~/client/tasks/internal/use_out_of_bounds_click_selection";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {tasksStyles} from "~/shared/styles/styles";

export type TaskRowPriorityCellRef = {
    focus(): void;
};

const TaskRowPriorityCellForwardRef = forwardRef(TaskRowPriorityCell);
export {TaskRowPriorityCellForwardRef as TaskRowPriorityCell};

function TaskRowPriorityCell(
    {
        priority,
        onPriorityChange,
        focusTaskNextCell,
        focusTaskPreviousCell,
    }: {
        priority: TaskPriority | null;
        onPriorityChange: (priority: TaskPriority | null) => void;
        focusTaskNextCell: () => void;
        focusTaskPreviousCell: () => void;
    },
    ref: Ref<TaskRowPriorityCellRef>,
) {
    const inputRef = useRef<TaskPriorityInputRef>(null);
    const [isHovered, hoverRef] = useHoverWithOverlaySupport();
    const [isFocusWithin, setIsFocusWithin] = useState(false);

    useImperativeHandle(
        ref,
        () => ({
            focus: () => assertExists(inputRef.current).focus(),
        }),
        [],
    );

    return (
        <Box
            ref={hoverRef}
            flexShrink="0"
            width={taskRowViewColumnWidth}
            paddingX={taskRowViewColumnPaddingX}
            overflow="hidden"
            className={tasksStyles.textCursorNotInheritedClassName}
            {...useOutOfBoundsClickSelection({
                onSelect: () => assertExists(inputRef.current).focus(),
                onSelectAll: () => assertExists(inputRef.current).focus(),
            })}
            onFocus={() => setIsFocusWithin(true)}
            onBlur={event => {
                setIsFocusWithin(event.currentTarget.contains(event.relatedTarget));
            }}
        >
            <Box
                height={taskRowViewMinHeight}
                display="flex"
                alignItems="center"
                className={tasksStyles.pointerEventsNoneNotInheritedClassName}
                opacity={priority || isHovered || isFocusWithin ? "100" : "0"}
            >
                <TaskPriorityInput
                    ref={inputRef}
                    aria-label="Priority"
                    priority={priority}
                    onPriorityChange={onPriorityChange}
                    onArrowLeftLeaveKeyDown={focusTaskPreviousCell}
                    onArrowRightLeaveKeyDown={focusTaskNextCell}
                />
            </Box>
        </Box>
    );
}
