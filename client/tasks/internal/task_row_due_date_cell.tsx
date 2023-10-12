import {KeyboardEvent, Ref, forwardRef, useImperativeHandle, useRef, useState} from "react";
import {useAppContext} from "~/client/context/app_context.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {
    getLastFocusableElementIfExists,
    getNextFocusableElementIfExists,
} from "~/client/design/helpers/get_next_focusable_element.js";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs.js";
import {useHoverWithOverlaySupport} from "~/client/helpers/use_hover_with_overlay_support.js";
import {TaskDateInput} from "~/client/tasks/internal/task_date_input.js";
import {TaskClientStore} from "~/client/tasks/task_client_store.js";
import {
    taskRowViewColumnPaddingX,
    taskRowViewColumnWidth,
    taskRowViewMinHeight,
} from "~/client/tasks/task_row_shared_styles.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {sprinkles} from "~/shared/styles/styles.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";

export type TaskRowDueDateCellRef = {
    focusCell(): void;
    focusCellInputStart(): void;
    focusCellInputEnd(): void;
};

// NOTE(calebmer): You are not allowed to use the `<Box>` component in this
// file. It is critical for scroll performance that this component renders
// fast. Manually use the `sprinkles()` function instead. This reduces the
// number of fibers React needs to render. One day we'd like to introduce
// transformations that automatically inline `<Box>` components and
// `sprinkles()` functions at which point using `<Box>` would not make a
// performance difference.
//
// So we assign the `Box` variable to null here so you get a TypeScript error
// if you try to use `<Box>`.
//
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const Box = null;

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
    const [isHovered, hoverRef] = useHoverWithOverlaySupport();
    const [isFocusWithin, setIsFocusWithin] = useState(false);

    useImperativeHandle(
        ref,
        () => ({
            focusCell: () => assertExists(cellRef.current).focus(),
            focusCellInputStart: () => {
                getNextFocusableElementIfExists(null, {
                    withinElement: assertExists(cellRef.current).firstElementChild,
                })?.focus();
            },
            focusCellInputEnd: () => {
                getLastFocusableElementIfExists({
                    withinElement: assertExists(cellRef.current).lastElementChild,
                })?.focus();
            },
        }),
        [],
    );

    return (
        <FocusRing isVisibleFromAnyFocus={true} offset="0" insetBottom="border">
            <div
                ref={useMergedRefs<HTMLDivElement>(cellRef, hoverRef)}
                tabIndex={-1}
                className={sprinkles({
                    flexShrink: "0",
                    width: taskRowViewColumnWidth,
                    height: taskRowViewMinHeight,
                    overflow: "hidden",
                    display: "flex",
                    alignItems: "center",
                    opacity: dueDate || isHovered || isFocusWithin ? "100" : "0",
                })}
                onFocus={() => setIsFocusWithin(true)}
                onBlur={event => {
                    setIsFocusWithin(event.currentTarget.contains(event.relatedTarget));
                }}
                onKeyDownCapture={onCellKeyDownCapture}
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
            </div>
        </FocusRing>
    );
}
