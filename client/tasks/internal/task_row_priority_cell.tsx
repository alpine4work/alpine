import {KeyboardEvent, Ref, forwardRef, useImperativeHandle, useRef, useState} from "react";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs.js";
import {useHoverWithOverlaySupport} from "~/client/helpers/use_hover_with_overlay_support.js";
import {
    TaskPriorityInput,
    TaskPriorityInputRef,
} from "~/client/tasks/internal/task_priority_input.js";
import {useOutOfBoundsClickSelection} from "~/client/tasks/internal/use_out_of_bounds_click_selection.js";
import {TaskClientStore} from "~/client/tasks/task_client_store.js";
import {
    taskRowViewColumnPaddingX,
    taskRowViewColumnWidth,
    taskRowViewMinHeight,
} from "~/client/tasks/task_row_shared_styles.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {tasksStyles} from "~/shared/styles/styles.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";

export type TaskRowPriorityCellRef = {
    focusCell(): void;
    focusInput(): void;
};

const TaskRowPriorityCellForwardRef = forwardRef(TaskRowPriorityCell);
export {TaskRowPriorityCellForwardRef as TaskRowPriorityCell};

function TaskRowPriorityCell(
    {
        store,
        task,
        onCellKeyDown,
        focusNextCell,
        focusPreviousCell,
    }: {
        store: TaskClientStore;
        task: TaskModel | null;
        onCellKeyDown: (event: KeyboardEvent) => void;
        focusNextCell: () => void;
        focusPreviousCell: () => void;
    },
    ref: Ref<TaskRowPriorityCellRef>,
) {
    const context = useAppContext();

    const priority = task?.getPriority() ?? null;

    const cellRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<TaskPriorityInputRef>(null);
    const [isHovered, hoverRef] = useHoverWithOverlaySupport();
    const [isFocusWithin, setIsFocusWithin] = useState(false);

    useImperativeHandle(
        ref,
        () => ({
            focusCell: () => assertExists(cellRef.current).focus(),
            focusInput: () => assertExists(inputRef.current).focus(),
        }),
        [],
    );

    return (
        <FocusRing offset="0" insetBottom="border">
            <Box
                ref={useMergedRefs<HTMLDivElement>(cellRef, hoverRef)}
                tabIndex={-1}
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
                onKeyDown={event => {
                    if (event.target === event.currentTarget) {
                        onCellKeyDown(event);
                    }
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
                        onPriorityChange={priority => {
                            if (!task) return task;

                            store.commitTaskActionTransaction(context, [
                                {
                                    type: "UpdateTask",
                                    time: store.clock.now(),
                                    taskId: task.id,
                                    taskAction: {
                                        type: "UpdatePriority",
                                        priority,
                                    },
                                },
                            ]);
                        }}
                        onArrowLeftLeaveKeyDown={focusPreviousCell}
                        onArrowRightLeaveKeyDown={focusNextCell}
                    />
                </Box>
            </Box>
        </FocusRing>
    );
}
