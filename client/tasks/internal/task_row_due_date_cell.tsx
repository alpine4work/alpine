import {KeyboardEvent, Ref, forwardRef, useImperativeHandle, useRef, useState} from "react";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {
    getLastFocusableElementIfExists,
    getNextFocusableElementIfExists,
} from "~/client/design/helpers/get_next_focusable_element.js";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs.js";
import {useHoverWithOverlaySupport} from "~/client/helpers/use_hover_with_overlay_support.js";
import {TaskDateInput} from "~/client/tasks/internal/task_date_input.js";
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

export type TaskRowDueDateCellRef = {
    focusCell(): void;
    focusCellInputStart(): void;
    focusCellInputEnd(): void;
};

const TaskRowDueDateCellForwardRef = forwardRef(TaskRowDueDateCell);
export {TaskRowDueDateCellForwardRef as TaskRowDueDateCell};

function TaskRowDueDateCell(
    {
        store,
        task,
        onCellKeyDownCapture,
        focusPreviousCell,
        focusNextCell,
    }: {
        store: TaskClientStore;
        task: TaskModel | null;
        onCellKeyDownCapture: (event: KeyboardEvent) => void;
        focusPreviousCell: () => void;
        focusNextCell: () => void;
    },
    ref: Ref<TaskRowDueDateCellRef>,
) {
    const context = useAppContext();

    const dueDate = task?.getDueDate() ?? null;

    const cellRef = useRef<HTMLDivElement>(null);
    const inputContainerRef = useRef<HTMLDivElement>(null);
    const [isHovered, hoverRef] = useHoverWithOverlaySupport();
    const [isFocusWithin, setIsFocusWithin] = useState(false);

    useImperativeHandle(
        ref,
        () => ({
            focusCell: () => assertExists(cellRef.current).focus(),
            focusCellInputStart: () => {
                getNextFocusableElementIfExists(null, {
                    withinElement: assertExists(inputContainerRef.current),
                })?.focus();
            },
            focusCellInputEnd: () => {
                getLastFocusableElementIfExists({
                    withinElement: assertExists(inputContainerRef.current),
                })?.focus();
            },
        }),
        [],
    );

    return (
        <FocusRing isVisibleFromAnyFocus={true} offset="0" insetBottom="border">
            <Box
                ref={useMergedRefs<HTMLDivElement>(cellRef, hoverRef)}
                tabIndex={-1}
                flexShrink="0"
                width={taskRowViewColumnWidth}
                overflow="hidden"
                className={tasksStyles.textCursorNotInheritedClassName}
                {...useOutOfBoundsClickSelection({
                    onSelect: () => {
                        getLastFocusableElementIfExists({
                            withinElement: assertExists(inputContainerRef.current),
                        })?.focus({preventScroll: true});
                    },
                    onSelectAll: () => {
                        getLastFocusableElementIfExists({
                            withinElement: assertExists(inputContainerRef.current),
                        })?.focus({preventScroll: true});
                    },
                })}
                onFocus={() => setIsFocusWithin(true)}
                onBlur={event => {
                    setIsFocusWithin(event.currentTarget.contains(event.relatedTarget));
                }}
                onKeyDownCapture={onCellKeyDownCapture}
            >
                <Box
                    ref={inputContainerRef}
                    height={taskRowViewMinHeight}
                    display="flex"
                    alignItems="center"
                    opacity={dueDate || isHovered || isFocusWithin ? "100" : "0"}
                >
                    <TaskDateInput
                        aria-label="Due date"
                        display="block"
                        height="full"
                        paddingX={taskRowViewColumnPaddingX}
                        overlayPlacement="bottom"
                        overlayOffset="-1"
                        focusRingAroundText={true}
                        shouldIncludeCalendarIcon={true}
                        shouldWarnIfAfterDate={true}
                        shouldFormatAroundToday={true}
                        date={dueDate}
                        onDateChange={dueDate => {
                            if (!task) return;

                            store.commitTaskActionTransaction(context, [
                                {
                                    type: "UpdateTask",
                                    time: store.clock.now(),
                                    taskId: task.id,
                                    taskAction: {
                                        type: "UpdateDueDate",
                                        dueDate,
                                    },
                                },
                            ]);
                        }}
                        // Keyboard navigation in grid view is not done with the tab key.
                        isTabbable={false}
                        onArrowLeftLeaveKeyDown={focusPreviousCell}
                        onArrowRightLeaveKeyDown={focusNextCell}
                    />
                </Box>
            </Box>
        </FocusRing>
    );
}
